import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db";
import { bookings, invoices, paymentEvents, payments } from "@/db/schema";
import { createBooking } from "@/lib/booking";
import { applyStatus } from "@/lib/payments";
import { at, customer, makeSalon, nextMonday, notification } from "./fixtures";

async function state(tenantId: string, bookingId: string) {
  return withTenant(tenantId, async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId));
    const [i] = await tx.select().from(invoices).where(eq(invoices.bookingId, bookingId));
    const [p] = await tx.select().from(payments).where(eq(payments.invoiceId, i.id));
    return { booking: b, invoice: i, payment: p };
  });
}

describe("Midtrans payments", () => {
  it("settlement confirms the booking and issues the first invoice number", async () => {
    const s = await makeSalon({ depositPercent: 50, taxRateBp: 1100 });
    const r = await createBooking(s.tenant, { serviceId: s.cut, startsAt: at(nextMonday(), "10:00"), customer: customer(1) });
    expect(r.invoice.total).toBe(83250);       // 75,000 + 11% PPN
    expect(r.payment.amount).toBe(41625);      // 50% deposit
    expect(r.invoice.number).toBeNull();       // no number until paid

    const res = await applyStatus(notification(r.payment.orderId, 41625, "settlement"), "notification", true);
    expect(res).toMatchObject({ outcome: "applied", state: "paid" });
    const st = await state(s.tenant.id, r.booking.id);
    expect(st.booking.status).toBe("confirmed");
    expect(st.invoice).toMatchObject({ status: "deposit_paid", amountPaid: 41625 });
    expect(st.invoice.number).toMatch(/^INV\/\d{4}\/0001$/);
  });

  it("a repeated or late notification changes nothing", async () => {
    const s = await makeSalon();
    const r = await createBooking(s.tenant, { serviceId: s.cut, startsAt: at(nextMonday(), "11:00"), customer: customer(1) });
    await applyStatus(notification(r.payment.orderId, 75000, "settlement"), "notification", true);
    expect(await applyStatus(notification(r.payment.orderId, 75000, "settlement"), "notification", true))
      .toMatchObject({ outcome: "ignored" });
    expect(await applyStatus(notification(r.payment.orderId, 75000, "pending"), "notification", true))
      .toMatchObject({ outcome: "ignored" });
    const st = await state(s.tenant.id, r.booking.id);
    expect(st.invoice).toMatchObject({ amountPaid: 75000, status: "paid" }); // not counted twice
    const events = await withTenant(s.tenant.id, (tx) => tx.select().from(paymentEvents).where(eq(paymentEvents.orderId, r.payment.orderId)));
    expect(events.map((e) => e.applied)).toEqual([true, false, false]);
  });

  it("a wrong amount is logged and ignored", async () => {
    const s = await makeSalon();
    const r = await createBooking(s.tenant, { serviceId: s.cut, startsAt: at(nextMonday(), "12:00"), customer: customer(1) });
    expect(await applyStatus(notification(r.payment.orderId, 1000, "settlement"), "notification", true))
      .toMatchObject({ outcome: "ignored" });
    expect((await state(s.tenant.id, r.booking.id)).booking.status).toBe("pending_payment");
  });

  it("expiry cancels the booking, voids the invoice and frees the slot", async () => {
    const s = await makeSalon();
    const day = nextMonday();
    const r = await createBooking(s.tenant, { serviceId: s.cut, staffId: s.andi, startsAt: at(day, "14:00"), customer: customer(1) });
    await applyStatus(notification(r.payment.orderId, 75000, "expire"), "notification", true);
    const st = await state(s.tenant.id, r.booking.id);
    expect(st.booking.status).toBe("cancelled");
    expect(st.invoice.status).toBe("void");
    const again = await createBooking(s.tenant, { serviceId: s.cut, staffId: s.andi, startsAt: at(day, "14:00"), customer: customer(2) });
    expect(again.booking.status).toBe("pending_payment");
  });

  it("paid after the hold expired: reinstated if free, flagged for refund if taken", async () => {
    const s = await makeSalon();
    const day = nextMonday();
    const now = new Date();
    const late = new Date(now.getTime() + (s.tenant.holdMinutes + 1) * 60000);
    const first = await createBooking(s.tenant, { serviceId: s.cut, staffId: s.andi, startsAt: at(day, "16:00"), customer: customer(1) }, now);
    await createBooking(s.tenant, { serviceId: s.cut, staffId: s.andi, startsAt: at(day, "16:00"), customer: customer(2) }, late);
    const res = await applyStatus(notification(first.payment.orderId, 75000, "settlement"), "notification", true);
    expect(res).toMatchObject({ outcome: "applied", state: "paid" });
    expect((res as { note?: string }).note).toMatch(/refund needed/);
    expect((await state(s.tenant.id, first.booking.id)).booking.status).toBe("cancelled");
  });

  it("invoice numbers stay gapless when 15 payments land at once", async () => {
    const s = await makeSalon();
    const day = nextMonday();
    const times = ["09:00", "09:45", "10:30", "11:15", "12:00", "12:45", "13:30", "14:15"];
    const made = [];
    for (const [i, t] of times.entries()) {
      made.push(await createBooking(s.tenant, { serviceId: s.cut, staffId: s.andi, startsAt: at(day, t), customer: customer(i) }));
      if (i < 7) made.push(await createBooking(s.tenant, { serviceId: s.cut, staffId: s.budi, startsAt: at(day, t), customer: customer(100 + i) }));
    }
    await Promise.all(made.map((r) => applyStatus(notification(r.payment.orderId, 75000, "settlement"), "notification", true)));
    const numbers = await withTenant(s.tenant.id, async (tx) => (await tx.select().from(invoices)).map((i) => i.number!));
    const seq = numbers.map((n) => Number(n.split("/")[2])).sort((a, b) => a - b);
    expect(seq).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it("a notification for an unknown order is logged without a salon", async () => {
    expect(await applyStatus(notification("BK-nope-1", 1000, "settlement"), "notification", true))
      .toEqual({ outcome: "unknown_order" });
  });
});
