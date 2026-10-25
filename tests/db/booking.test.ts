import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant } from "@/db";
import { bookings, invoices } from "@/db/schema";
import { createBooking, SlotTaken, slotsFor } from "@/lib/booking";
import { at, customer, makeSalon, nextMonday } from "./fixtures";

describe("booking", () => {
  it("20 customers racing for the same barber and minute: exactly one wins", async () => {
    const s = await makeSalon();
    const day = nextMonday();
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) =>
      createBooking(s.tenant, { serviceId: s.cut, staffId: s.andi, startsAt: at(day, "11:00"), customer: customer(i) })));
    const ok = results.filter((r) => r.status === "fulfilled");
    const taken = results.filter((r) => r.status === "rejected" && r.reason instanceof SlotTaken);
    expect(ok).toHaveLength(1);
    expect(taken).toHaveLength(19);
  });

  it("'anyone' fills the second barber, then the slot disappears", async () => {
    const s = await makeSalon();
    const day = nextMonday();
    const first = await createBooking(s.tenant, { serviceId: s.cut, startsAt: at(day, "13:00"), customer: customer(1) });
    const second = await createBooking(s.tenant, { serviceId: s.cut, startsAt: at(day, "13:00"), customer: customer(2) });
    expect(first.booking.staffId).not.toBe(second.booking.staffId);
    await expect(createBooking(s.tenant, { serviceId: s.cut, startsAt: at(day, "13:00"), customer: customer(3) }))
      .rejects.toBeInstanceOf(SlotTaken);
    const slots = await withTenant(s.tenant.id, (tx) => slotsFor(tx, s.tenant, s.cut, day));
    expect(slots.some((x) => x.start.getTime() === at(day, "13:00").getTime())).toBe(false);
    expect(slots.some((x) => x.start.getTime() === at(day, "13:45").getTime())).toBe(true); // back to back
  });

  it("an unpaid hold releases the slot once it expires", async () => {
    const s = await makeSalon();
    const day = nextMonday();
    const now = new Date();
    const first = await createBooking(s.tenant, { serviceId: s.cut, staffId: s.andi, startsAt: at(day, "15:00"), customer: customer(1) }, now);
    await expect(createBooking(s.tenant, { serviceId: s.cut, staffId: s.andi, startsAt: at(day, "15:00"), customer: customer(2) }, now))
      .rejects.toBeInstanceOf(SlotTaken);

    const later = new Date(now.getTime() + (s.tenant.holdMinutes + 1) * 60000);
    const second = await createBooking(s.tenant, { serviceId: s.cut, staffId: s.andi, startsAt: at(day, "15:00"), customer: customer(2) }, later);
    expect(second.booking.status).toBe("pending_payment");
    const [old] = await withTenant(s.tenant.id, (tx) => tx.select().from(bookings).where(eq(bookings.id, first.booking.id)));
    expect(old.status).toBe("cancelled");
  });

  it("rejects times that are not offered (outside hours, Sunday)", async () => {
    const s = await makeSalon();
    const day = nextMonday();
    await expect(createBooking(s.tenant, { serviceId: s.cut, startsAt: at(day, "16:30"), customer: customer(1) }))
      .rejects.toBeInstanceOf(SlotTaken); // 45 min would end after 17:00
    const sunday = new Date(at(day, "10:00").getTime() - 86400000);
    await expect(createBooking(s.tenant, { serviceId: s.cut, startsAt: sunday, customer: customer(1) }))
      .rejects.toBeInstanceOf(SlotTaken);
  });

  it("a returning customer (same phone) is one record; old invoices keep the name they were issued to", async () => {
    const s = await makeSalon();
    const day = nextMonday();
    const a = await createBooking(s.tenant, { serviceId: s.cut, startsAt: at(day, "09:00"), customer: customer(7) });
    const b = await createBooking(s.tenant, { serviceId: s.shave, startsAt: at(day, "10:00"),
                                              customer: { ...customer(7), name: "Nama Baru" } });
    expect(a.customer.id).toBe(b.customer.id);
    expect(b.customer.name).toBe("Nama Baru");
    const [first] = await withTenant(s.tenant.id, (tx) => tx.select().from(invoices).where(eq(invoices.id, a.invoice.id)));
    expect(first.billName).toBe("Pelanggan 7");
  });
});
