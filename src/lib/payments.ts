import { and, eq, sql } from "drizzle-orm";
import { db, withTenant, type Tx } from "@/db";
import { bookings, invoiceCounters, invoices, paymentEvents, payments, tenants } from "@/db/schema";
import { pgCode } from "./booking";
import { canTransition, getStatus, toPaymentState, type MidtransStatus } from "./midtrans";
import { invoiceNumber } from "./money";

export type ApplyResult =
  | { outcome: "applied"; state: string; note?: string }
  | { outcome: "ignored"; reason: string }
  | { outcome: "unknown_order" };

async function tenantOfOrder(orderId: string): Promise<string | null> {
  const rows = await db.execute<{ tenant_id: string | null }>(sql`select tenant_of_order(${orderId}) as tenant_id`);
  return rows[0]?.tenant_id ?? null;
}

/** Next gapless invoice number for the salon and year (row-locked counter). */
export async function nextInvoiceNumber(tx: Tx, tenantId: string, year: number): Promise<string> {
  const [row] = await tx.insert(invoiceCounters).values({ tenantId, year, lastNo: 1 })
    .onConflictDoUpdate({ target: [invoiceCounters.tenantId, invoiceCounters.year],
                          set: { lastNo: sql`${invoiceCounters.lastNo} + 1` } })
    .returning({ n: invoiceCounters.lastNo });
  return invoiceNumber(year, row.n);
}

/**
 * Applies a Midtrans transaction status to our payment, invoice and booking.
 * Safe to call any number of times, in any order, from the webhook or from a
 * status check: every call is logged, only forward transitions change state.
 */
export async function applyStatus(status: MidtransStatus, source: "notification" | "status_check",
                                  signatureValid: boolean | null = null): Promise<ApplyResult> {
  const tenantId = await tenantOfOrder(status.order_id);
  if (!tenantId) {
    await db.insert(paymentEvents).values({ orderId: status.order_id, source, signatureValid, applied: false,
      transactionStatus: status.transaction_status ?? null, payload: status });
    return { outcome: "unknown_order" };
  }

  return withTenant(tenantId, async (tx) => {
    const log = (applied: boolean) => tx.insert(paymentEvents).values({
      tenantId, orderId: status.order_id, source, signatureValid, applied,
      transactionStatus: status.transaction_status ?? null, payload: status,
    });
    const [payment] = await tx.select().from(payments).where(eq(payments.orderId, status.order_id)).for("update");
    const target = toPaymentState(status.transaction_status, status.fraud_status);

    let reason: string | null = null;
    if (!target) reason = `unhandled transaction_status ${status.transaction_status}`;
    else if (Math.round(Number(status.gross_amount)) !== payment.amount) reason = `amount ${status.gross_amount} != ${payment.amount}`;
    else if (!canTransition(payment.status, target)) reason = `${payment.status} -> ${target} not allowed`;
    if (reason || !target) {
      await log(false);
      return { outcome: "ignored", reason: reason! };
    }

    const now = new Date();
    await tx.update(payments).set({
      status: target, paymentType: status.payment_type ?? payment.paymentType, updatedAt: now,
      paidAt: target === "paid" ? now : payment.paidAt,
    }).where(eq(payments.id, payment.id));

    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).for("update");
    const [booking] = await tx.select().from(bookings).where(eq(bookings.id, invoice.bookingId)).for("update");
    let note: string | undefined;

    if (target === "paid") {
      const amountPaid = invoice.amountPaid + payment.amount;
      let number = invoice.number;
      if (!number) {
        const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
        const year = Number(new Intl.DateTimeFormat("en", { timeZone: t.tz, year: "numeric" }).format(now));
        number = await nextInvoiceNumber(tx, tenantId, year);
      }
      await tx.update(invoices).set({
        amountPaid, number, issuedAt: invoice.issuedAt ?? now,
        status: amountPaid >= invoice.total ? "paid" : "deposit_paid",
      }).where(eq(invoices.id, invoice.id));

      if (booking.status === "pending_payment" || booking.status === "cancelled") {
        try {
          await tx.transaction(async (sp) => {
            await sp.update(bookings).set({ status: "confirmed", holdUntil: null }).where(eq(bookings.id, booking.id));
          });
          if (booking.status === "cancelled") note = "paid after the hold expired; slot was still free, booking reinstated";
        } catch (e) {
          if (pgCode(e) !== "23P01") throw e;
          note = "paid after the hold expired and the slot was taken: refund needed";
        }
      }
    } else if (target === "failed" || target === "expired") {
      if (booking.status === "pending_payment") {
        await tx.update(bookings).set({ status: "cancelled", holdUntil: null }).where(eq(bookings.id, booking.id));
      }
      if (invoice.amountPaid === 0) await tx.update(invoices).set({ status: "void" }).where(eq(invoices.id, invoice.id));
    } else if (target === "refunded") {
      const amountPaid = Math.max(0, invoice.amountPaid - payment.amount);
      await tx.update(invoices).set({ amountPaid, status: amountPaid === 0 ? "void" : "deposit_paid" })
        .where(eq(invoices.id, invoice.id));
      await tx.update(bookings).set({ status: "cancelled", holdUntil: null })
        .where(and(eq(bookings.id, booking.id), eq(bookings.status, "confirmed")));
    }

    await log(true);
    return { outcome: "applied", state: target, note };
  });
}

/** Asks Midtrans for the order's status and applies it (customer returned, or a notification arrived). */
export async function reconcile(orderId: string): Promise<ApplyResult | null> {
  const status = await getStatus(orderId);
  if (!status) return null;
  return applyStatus(status, "status_check");
}
