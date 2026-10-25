import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db, withTenant } from "@/db";
import { bookings, customers, paymentEvents, staff } from "@/db/schema";
import { createBooking } from "@/lib/booking";
import { at, customer, makeSalon, nextMonday } from "./fixtures";

describe("row level security", () => {
  it("a salon sees only its own rows, even with no WHERE clause", async () => {
    const a = await makeSalon();
    const b = await makeSalon();
    const day = nextMonday();
    await createBooking(a.tenant, { serviceId: a.cut, startsAt: at(day, "10:00"), customer: customer(1) });

    const seenByA = await withTenant(a.tenant.id, (tx) => tx.select().from(bookings));
    const seenByB = await withTenant(b.tenant.id, (tx) => tx.select().from(bookings));
    expect(seenByA.length).toBeGreaterThan(0);
    expect(seenByA.every((r) => r.tenantId === a.tenant.id)).toBe(true);
    expect(seenByB.some((r) => r.tenantId === a.tenant.id)).toBe(false);
    expect(await withTenant(b.tenant.id, (tx) => tx.select().from(customers))).toHaveLength(0);
  });

  it("without a tenant context the app sees nothing", async () => {
    await makeSalon();
    expect(await db.select().from(staff)).toHaveLength(0);
    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it("cannot write rows into another salon", async () => {
    const a = await makeSalon();
    const b = await makeSalon();
    await expect(withTenant(a.tenant.id, (tx) => tx.insert(staff).values({ tenantId: b.tenant.id, name: "Intruder" })))
      .rejects.toThrow();
  });

  it("the payment audit trail is append-only for the app", async () => {
    await db.insert(paymentEvents).values({ orderId: "x", source: "notification", applied: false, payload: {} });
    await expect(db.execute(sql`update payment_events set applied = true`)).rejects.toThrow();
    await expect(db.execute(sql`delete from payment_events`)).rejects.toThrow();
  });
});
