import { randomUUID } from "node:crypto";
import { db, withTenant } from "@/db";
import { services, staff, staffServices, tenants, workingHours } from "@/db/schema";
import { signature, type MidtransStatus } from "@/lib/midtrans";
import { addDays, localDate, localToUtc, weekday } from "@/lib/time";

export const TZ = "Asia/Jakarta";
export const KEY = process.env.MIDTRANS_SERVER_KEY ?? "SB-Mid-server-test";

/** A Monday at least a week ahead, so lead times never interfere. */
export function nextMonday(): string {
  let d = addDays(localDate(new Date(), TZ), 7);
  while (weekday(d) !== 1) d = addDays(d, 1);
  return d;
}
export const at = (date: string, hhmm: string) => localToUtc(date, +hhmm.slice(0, 2) * 60 + +hhmm.slice(3), TZ);

/** A salon with two barbers (Mon-Sat 09:00-17:00) and two services. */
export async function makeSalon(opts: { depositPercent?: number; taxRateBp?: number } = {}) {
  const [tenant] = await db.insert(tenants).values({
    slug: `t-${randomUUID().slice(0, 8)}`, name: "Test Barbershop",
    depositPercent: opts.depositPercent ?? 100, taxRateBp: opts.taxRateBp ?? 0,
  }).returning();
  const ids = await withTenant(tenant.id, async (tx) => {
    const [a, b] = await tx.insert(staff).values([{ tenantId: tenant.id, name: "Andi" }, { tenantId: tenant.id, name: "Budi" }]).returning();
    const [cut, shave] = await tx.insert(services).values([
      { tenantId: tenant.id, name: "Potong rambut", durationMin: 45, price: 75000 },
      { tenantId: tenant.id, name: "Cukur jenggot", durationMin: 30, price: 40000 },
    ]).returning();
    await tx.insert(staffServices).values([a, b].flatMap((s) => [cut, shave].map((v) => ({ tenantId: tenant.id, staffId: s.id, serviceId: v.id }))));
    await tx.insert(workingHours).values([a, b].flatMap((s) => [1, 2, 3, 4, 5, 6].map((weekday) =>
      ({ tenantId: tenant.id, staffId: s.id, weekday, startMin: 540, endMin: 1020 }))));
    return { andi: a.id, budi: b.id, cut: cut.id, shave: shave.id };
  });
  return { tenant, ...ids };
}

/** A notification as Midtrans would send it, correctly signed. */
export function notification(orderId: string, amount: number, transactionStatus: string, extra: Partial<MidtransStatus> = {}): MidtransStatus {
  const statusCode = transactionStatus === "settlement" || transactionStatus === "capture" ? "200"
    : transactionStatus === "pending" ? "201" : "407";
  const gross = `${amount}.00`;
  return { order_id: orderId, status_code: statusCode, gross_amount: gross, transaction_status: transactionStatus,
           payment_type: "qris", signature_key: signature(orderId, statusCode, gross, KEY), ...extra };
}

export const customer = (n: number) => ({ name: `Pelanggan ${n}`, phone: `62812000${String(n).padStart(4, "0")}` });
