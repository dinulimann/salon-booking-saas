"use server";

import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { bookings, invoices, services, staff, staffServices, tenants, workingHours } from "@/db/schema";
import { nextInvoiceNumber } from "@/lib/payments";
import { requireSalon } from "@/lib/session";

// Every action re-checks the session and runs inside the owner's salon, so a
// forged id from another salon simply matches no row (Row Level Security).

export async function setBookingStatus(bookingId: string, status: "completed" | "no_show" | "cancelled") {
  const { tenant } = await requireSalon();
  await withTenant(tenant.id, (tx) => tx.update(bookings).set({ status, holdUntil: null })
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, "confirmed"))));
  refresh();
}

/** The rest of the bill paid at the counter (cash, EDC). */
export async function settleAtCounter(invoiceId: string) {
  const { tenant } = await requireSalon();
  await withTenant(tenant.id, async (tx) => {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!inv || inv.status === "void" || inv.amountPaid >= inv.total) return;
    const number = inv.number ?? await nextInvoiceNumber(tx, tenant.id, Number(
      new Intl.DateTimeFormat("en", { timeZone: tenant.timezone, year: "numeric" }).format(new Date())));
    await tx.update(invoices).set({ amountPaid: inv.total, status: "paid", number, issuedAt: inv.issuedAt ?? new Date() })
      .where(eq(invoices.id, inv.id));
  });
  refresh();
}

const ServiceInput = z.object({
  name: z.string().trim().min(2).max(80),
  durationMin: z.coerce.number().int().min(5).max(480).refine((n) => n % 5 === 0, "kelipatan 5 menit"),
  price: z.coerce.number().int().min(0),
});

export async function addService(form: FormData) {
  const { tenant } = await requireSalon();
  const v = ServiceInput.parse(Object.fromEntries(form));
  await withTenant(tenant.id, async (tx) => {
    const [svc] = await tx.insert(services).values({ tenantId: tenant.id, ...v }).returning();
    // offered by every active staff member until the owner says otherwise
    const team = await tx.select({ id: staff.id }).from(staff).where(eq(staff.active, true));
    if (team.length) await tx.insert(staffServices).values(team.map((s) => ({ tenantId: tenant.id, staffId: s.id, serviceId: svc.id })));
  });
  refresh();
}

export async function toggleService(id: string, active: boolean) {
  const { tenant } = await requireSalon();
  await withTenant(tenant.id, (tx) => tx.update(services).set({ active }).where(eq(services.id, id)));
  refresh();
}

export async function addStaff(form: FormData) {
  const { tenant } = await requireSalon();
  const name = z.string().trim().min(2).max(60).parse(form.get("name"));
  await withTenant(tenant.id, async (tx) => {
    const [s] = await tx.insert(staff).values({ tenantId: tenant.id, name }).returning();
    await tx.insert(workingHours).values([1, 2, 3, 4, 5, 6].map((weekday) =>
      ({ tenantId: tenant.id, staffId: s.id, weekday, startMin: 540, endMin: 1080 })));
    const all = await tx.select({ id: services.id }).from(services).where(eq(services.active, true));
    if (all.length) await tx.insert(staffServices).values(all.map((v) => ({ tenantId: tenant.id, staffId: s.id, serviceId: v.id })));
  });
  refresh();
}

export async function toggleStaff(id: string, active: boolean) {
  const { tenant } = await requireSalon();
  await withTenant(tenant.id, (tx) => tx.update(staff).set({ active }).where(eq(staff.id, id)));
  refresh();
}

const toMin = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

/** Weekly hours from the form: start_<weekday>/end_<weekday> as HH:MM, empty = day off. */
export async function saveHours(staffId: string, form: FormData) {
  const { tenant } = await requireSalon();
  const rows: (typeof workingHours.$inferInsert)[] = [];
  for (let d = 0; d < 7; d++) {
    const s = String(form.get(`start_${d}`) ?? ""), e = String(form.get(`end_${d}`) ?? "");
    if (!s || !e) continue;
    if (toMin(s) >= toMin(e)) throw new Error("Jam mulai harus sebelum jam selesai");
    rows.push({ tenantId: tenant.id, staffId, weekday: d, startMin: toMin(s), endMin: toMin(e) });
  }
  await withTenant(tenant.id, async (tx) => {
    await tx.delete(workingHours).where(eq(workingHours.staffId, staffId));
    if (rows.length) await tx.insert(workingHours).values(rows);
  });
  refresh();
}

const Settings = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().max(200),
  phone: z.string().trim().max(30),
  taxPercent: z.coerce.number().min(0).max(20),
  depositPercent: z.coerce.number().int().min(10).max(100),
  holdMinutes: z.coerce.number().int().min(5).max(60),
});

export async function saveSettings(form: FormData) {
  const { tenant } = await requireSalon();
  const v = Settings.parse(Object.fromEntries(form));
  await withTenant(tenant.id, (tx) => tx.update(tenants).set({
    name: v.name, address: v.address || null, phone: v.phone || null,
    taxRateBp: Math.round(v.taxPercent * 100), depositPercent: v.depositPercent, holdMinutes: v.holdMinutes,
  }).where(eq(tenants.id, tenant.id)));
  refresh();
}
