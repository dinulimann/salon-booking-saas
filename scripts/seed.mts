// Demo data: two salons with owners, staff, services, hours and two weeks of
// history. Idempotent: does nothing if the demo salons exist.
//   owner@kumis.test / demo12345   (Barbershop Kumis, pay in full, no PPN)
//   owner@melati.test / demo12345  (Salon Melati, 50% deposit, PPN 11%)
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, withTenant } from "@/db";
import { bookings, customers, invoices, memberships, payments, services, staff, staffServices, tenants, workingHours } from "@/db/schema";
import { auth } from "@/lib/auth";
import { invoiceAmounts } from "@/lib/money";
import { nextInvoiceNumber } from "@/lib/payments";
import { addDays, localDate, localToUtc, weekday } from "@/lib/time";

type Spec = {
  slug: string; name: string; address: string; phone: string; depositPercent: number; taxRateBp: number;
  owner: { name: string; email: string };
  team: { name: string; days: number[]; start: number; end: number }[];
  menu: { name: string; durationMin: number; price: number }[];
};

const salons: Spec[] = [
  {
    slug: "kumis", name: "Barbershop Kumis", address: "Jl. Kemang Raya 12, Jakarta Selatan", phone: "0812-1111-2222",
    depositPercent: 100, taxRateBp: 0, owner: { name: "Pak Kumis", email: "owner@kumis.test" },
    team: [
      { name: "Andi", days: [1, 2, 3, 4, 5, 6], start: 600, end: 1260 },
      { name: "Budi", days: [0, 2, 3, 4, 5, 6], start: 600, end: 1260 },
      { name: "Cahyo", days: [1, 2, 3, 4, 5], start: 780, end: 1260 },
    ],
    menu: [
      { name: "Potong rambut", durationMin: 45, price: 75000 },
      { name: "Potong + cuci + styling", durationMin: 60, price: 95000 },
      { name: "Cukur jenggot", durationMin: 30, price: 40000 },
      { name: "Hair spa", durationMin: 60, price: 120000 },
      { name: "Pewarnaan rambut", durationMin: 90, price: 250000 },
    ],
  },
  {
    slug: "melati", name: "Salon Melati", address: "Jl. Riau 45, Bandung", phone: "0813-3333-4444",
    depositPercent: 50, taxRateBp: 1100, owner: { name: "Bu Melati", email: "owner@melati.test" },
    team: [
      { name: "Rina", days: [1, 2, 3, 4, 5, 6], start: 540, end: 1080 },
      { name: "Sari", days: [2, 3, 4, 5, 6, 0], start: 540, end: 1080 },
    ],
    menu: [
      { name: "Potong rambut wanita", durationMin: 45, price: 100000 },
      { name: "Creambath", durationMin: 60, price: 150000 },
      { name: "Smoothing", durationMin: 180, price: 650000 },
      { name: "Pewarnaan rambut", durationMin: 120, price: 450000 },
    ],
  },
];

const names = ["Rizky", "Dimas", "Fajar", "Bayu", "Agus", "Hendra", "Yoga", "Reza", "Arif", "Taufik", "Dewi", "Putri", "Ayu", "Nina", "Lestari", "Fitri"];
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

for (const spec of salons) {
  const [exists] = await db.select().from(tenants).where(eq(tenants.slug, spec.slug));
  if (exists) { console.log(`${spec.slug}: exists, skipped`); continue; }

  const { user } = await auth.api.signUpEmail({ body: { name: spec.owner.name, email: spec.owner.email, password: "demo12345" } });
  const [tenant] = await db.insert(tenants).values({
    slug: spec.slug, name: spec.name, address: spec.address, phone: spec.phone,
    depositPercent: spec.depositPercent, taxRateBp: spec.taxRateBp,
  }).returning();

  const count = await withTenant(tenant.id, async (tx) => {
    await tx.insert(memberships).values({ tenantId: tenant.id, userId: user.id, role: "owner" });
    const team = await tx.insert(staff).values(spec.team.map((t) => ({ tenantId: tenant.id, name: t.name }))).returning();
    const menu = await tx.insert(services).values(spec.menu.map((m) => ({ tenantId: tenant.id, ...m }))).returning();
    await tx.insert(staffServices).values(team.flatMap((s) => menu.map((m) => ({ tenantId: tenant.id, staffId: s.id, serviceId: m.id }))));
    await tx.insert(workingHours).values(spec.team.flatMap((t, i) => t.days.map((weekday) =>
      ({ tenantId: tenant.id, staffId: team[i].id, weekday, startMin: t.start, endMin: t.end }))));

    // History: the past 14 days, completed and paid (online deposit + rest at the counter).
    const today = localDate(new Date(), tenant.timezone);
    let n = 0;
    for (let back = 14; back >= 1; back--) {
      const date = addDays(today, -back);
      for (const [i, member] of team.entries()) {
        if (!spec.team[i].days.includes(weekday(date))) continue;
        let minute = spec.team[i].start + 15 * Math.floor(rand() * 4);
        while (true) {
          const svc = menu[Math.floor(rand() * menu.length)];
          if (minute + svc.durationMin > spec.team[i].end) break;
          if (rand() < 0.45) { minute += 30; continue; } // idle time
          const startsAt = localToUtc(date, minute, tenant.timezone);
          const name = names[Math.floor(rand() * names.length)];
          const phone = `62812${String(Math.floor(rand() * 1e8)).padStart(8, "0")}`;
          const [c] = await tx.insert(customers).values({ tenantId: tenant.id, name, phone })
            .onConflictDoUpdate({ target: [customers.tenantId, customers.phone], set: { name } }).returning();
          const noShow = rand() < 0.04;
          const [b] = await tx.insert(bookings).values({
            tenantId: tenant.id, staffId: member.id, serviceId: svc.id, customerId: c.id, startsAt,
            endsAt: new Date(startsAt.getTime() + svc.durationMin * 60000), status: noShow ? "no_show" : "completed", price: svc.price,
            createdAt: new Date(startsAt.getTime() - 86400000 * (1 + Math.floor(rand() * 5))),
          }).returning();
          const a = invoiceAmounts(svc.price, spec.taxRateBp, spec.depositPercent);
          const paidAt = new Date(b.createdAt.getTime() + 120000);
          const number = await nextInvoiceNumber(tx, tenant.id, Number(date.slice(0, 4)));
          const paidTotal = noShow ? a.depositDue : a.total;
          const [inv] = await tx.insert(invoices).values({ tenantId: tenant.id, bookingId: b.id, ...a, number, billName: name, billPhone: phone, issuedAt: paidAt,
            amountPaid: paidTotal, status: paidTotal >= a.total ? "paid" : "deposit_paid", createdAt: b.createdAt }).returning();
          await tx.insert(payments).values({ tenantId: tenant.id, invoiceId: inv.id, amount: a.depositDue, status: "paid",
            orderId: `BK-${b.id.slice(0, 8)}-seed`, paymentType: ["qris", "gopay", "bank_transfer", "shopeepay"][Math.floor(rand() * 4)],
            paidAt, createdAt: b.createdAt });
          n++;
          minute += svc.durationMin + 15 * Math.floor(rand() * 3);
        }
      }
    }
    return n;
  });
  console.log(`${spec.slug}: owner ${spec.owner.email}, ${spec.team.length} staff, ${spec.menu.length} services, ${count} past bookings`);
}
process.exit(0);
