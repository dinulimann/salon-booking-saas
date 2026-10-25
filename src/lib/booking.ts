import { and, asc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { db, withTenant, type Tx } from "@/db";
import { bookings, customers, invoices, payments, services, staff, staffServices, tenants, workingHours } from "@/db/schema";
import { availableSlots, type Slot } from "./availability";
import { invoiceAmounts } from "./money";
import { addDays, localToUtc, weekday } from "./time";

export type Tenant = typeof tenants.$inferSelect;

export async function tenantBySlug(slug: string): Promise<Tenant | null> {
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  return t ?? null;
}

export class SlotTaken extends Error {
  constructor() { super("That time was just taken. Please pick another slot."); }
}

/** Postgres error code of a (possibly drizzle-wrapped) error. */
export function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code ?? err?.cause?.code;
}

/** Active = confirmed, or waiting for payment and still inside its hold. */
const active = (now: Date) => or(
  eq(bookings.status, "confirmed"),
  and(eq(bookings.status, "pending_payment"), gt(bookings.holdUntil, now)),
);

export async function slotsFor(tx: Tx, tenant: Tenant, serviceId: string, date: string, now = new Date()): Promise<Slot[]> {
  const [service] = await tx.select().from(services).where(and(eq(services.id, serviceId), eq(services.active, true)));
  if (!service) return [];
  const who = await tx.select({ id: staff.id }).from(staff)
    .innerJoin(staffServices, eq(staffServices.staffId, staff.id))
    .where(and(eq(staffServices.serviceId, serviceId), eq(staff.active, true)));
  if (!who.length) return [];
  const ids = who.map((w) => w.id);
  const hours = await tx.select().from(workingHours)
    .where(and(inArray(workingHours.staffId, ids), eq(workingHours.weekday, weekday(date))));
  const dayStart = localToUtc(date, 0, tenant.timezone);
  const dayEnd = localToUtc(addDays(date, 1), 0, tenant.timezone);
  const busy = await tx.select({ staffId: bookings.staffId, start: bookings.startsAt, end: bookings.endsAt })
    .from(bookings)
    .where(and(inArray(bookings.staffId, ids), lt(bookings.startsAt, dayEnd), gt(bookings.endsAt, dayStart), active(now)));

  return availableSlots({
    date, tz: tenant.timezone, durationMin: service.durationMin, now,
    staff: ids.map((id) => ({
      id,
      hours: hours.filter((h) => h.staffId === id).map((h) => ({ startMin: h.startMin, endMin: h.endMin })),
      busy: busy.filter((b) => b.staffId === id),
    })),
  });
}

export type NewBooking = {
  serviceId: string;
  staffId?: string | null; // null = anyone free
  startsAt: Date;
  customer: { name: string; phone: string; email?: string | null };
  note?: string | null;
};

/**
 * Holds the slot (status pending_payment until hold_until), creates the
 * invoice and the payment row. The Midtrans call happens after this commits,
 * so no transaction stays open during an HTTP request.
 */
export async function createBooking(tenant: Tenant, input: NewBooking, now = new Date()) {
  return withTenant(tenant.id, async (tx) => {
    const [service] = await tx.select().from(services).where(and(eq(services.id, input.serviceId), eq(services.active, true)));
    if (!service) throw new Error("Service not found");

    const date = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone }).format(input.startsAt);
    const slot = (await slotsFor(tx, tenant, service.id, date, now))
      .find((s) => s.start.getTime() === input.startsAt.getTime());
    if (!slot) throw new SlotTaken();
    const staffId = input.staffId ?? slot.staffIds[0];
    if (!slot.staffIds.includes(staffId)) throw new SlotTaken();

    // Holds that ran out stop blocking the exclusion constraint.
    await tx.update(bookings).set({ status: "cancelled", holdUntil: null })
      .where(and(eq(bookings.staffId, staffId), eq(bookings.status, "pending_payment"), lt(bookings.holdUntil, now)));

    const [customer] = await tx.insert(customers)
      .values({ tenantId: tenant.id, name: input.customer.name, phone: input.customer.phone, email: input.customer.email })
      .onConflictDoUpdate({
        target: [customers.tenantId, customers.phone],
        set: { name: input.customer.name, email: sql`coalesce(excluded.email, ${customers.email})` },
      })
      .returning();

    let booking;
    try {
      // Savepoint, so a lost race surfaces as SlotTaken instead of aborting everything.
      booking = await tx.transaction(async (sp) => (await sp.insert(bookings).values({
        tenantId: tenant.id, staffId, serviceId: service.id, customerId: customer.id,
        startsAt: slot.start, endsAt: slot.end, status: "pending_payment",
        holdUntil: new Date(now.getTime() + tenant.holdMinutes * 60000),
        price: service.price, note: input.note,
      }).returning())[0]);
    } catch (e) {
      if (pgCode(e) === "23P01") throw new SlotTaken(); // exclusion_violation: someone else got it first
      throw e;
    }

    const amounts = invoiceAmounts(service.price, tenant.taxRateBp, tenant.depositPercent);
    const [invoice] = await tx.insert(invoices).values({
      tenantId: tenant.id, bookingId: booking.id, ...amounts,
      billName: input.customer.name, billPhone: input.customer.phone, billEmail: input.customer.email ?? null,
    }).returning();
    const [payment] = await tx.insert(payments).values({
      tenantId: tenant.id, invoiceId: invoice.id, amount: amounts.depositDue,
      orderId: `BK-${booking.id.slice(0, 8)}-${now.getTime().toString(36)}`,
    }).returning();
    return { booking, invoice, payment, service, customer };
  });
}

export async function bookingView(tenant: Tenant, bookingId: string) {
  return withTenant(tenant.id, async (tx) => {
    const [row] = await tx.select({
      booking: bookings, service: services, staffName: staff.name, customer: customers, invoice: invoices,
    }).from(bookings)
      .innerJoin(services, eq(services.id, bookings.serviceId))
      .innerJoin(staff, eq(staff.id, bookings.staffId))
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .innerJoin(invoices, eq(invoices.bookingId, bookings.id))
      .where(eq(bookings.id, bookingId));
    if (!row) return null;
    const pays = await tx.select().from(payments).where(eq(payments.invoiceId, row.invoice.id)).orderBy(asc(payments.createdAt));
    return { ...row, payments: pays };
  });
}
