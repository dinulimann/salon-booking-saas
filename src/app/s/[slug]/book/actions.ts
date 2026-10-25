"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db";
import { bookings, invoices, payments } from "@/db/schema";
import { createBooking, SlotTaken, tenantBySlug } from "@/lib/booking";
import { createSnapTransaction } from "@/lib/midtrans";
import { normalizePhone } from "@/lib/phone";

export type BookState = { error?: string };

const Input = z.object({
  slug: z.string(),
  serviceId: z.uuid(),
  staffId: z.union([z.uuid(), z.literal("")]),
  startsAt: z.iso.datetime(),
  name: z.string().trim().min(2, "Nama minimal 2 huruf").max(80),
  phone: z.string(),
  email: z.union([z.email("Email tidak valid"), z.literal("")]),
  note: z.string().max(300).optional(),
});

export async function book(_: BookState, form: FormData): Promise<BookState> {
  const parsed = Input.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const phone = normalizePhone(v.phone);
  if (!phone) return { error: "Nomor HP tidak valid (contoh: 0812 3456 7890)" };
  const tenant = await tenantBySlug(v.slug);
  if (!tenant) return { error: "Salon tidak ditemukan" };

  let made;
  try {
    made = await createBooking(tenant, {
      serviceId: v.serviceId, staffId: v.staffId || null, startsAt: new Date(v.startsAt),
      customer: { name: v.name, phone, email: v.email || null }, note: v.note || null,
    });
  } catch (e) {
    if (e instanceof SlotTaken) return { error: "Jam itu baru saja diambil orang lain. Silakan pilih jam lain." };
    throw e;
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  let snap;
  try {
    snap = await createSnapTransaction({
      orderId: made.payment.orderId, amount: made.payment.amount,
      item: { id: made.service.id, name: `${made.payment.amount < made.invoice.total ? "DP " : ""}${made.service.name}` },
      customer: { name: v.name, phone, email: v.email || null },
      finishUrl: `${appUrl}/s/${tenant.slug}/booking/${made.booking.id}`,
      expiryMinutes: tenant.holdMinutes,
    });
  } catch (e) {
    console.error(e);
    // Release the slot: without a payment page nobody can pay for it.
    await withTenant(tenant.id, async (tx) => {
      await tx.update(bookings).set({ status: "cancelled", holdUntil: null }).where(eq(bookings.id, made.booking.id));
      await tx.update(invoices).set({ status: "void" }).where(eq(invoices.id, made.invoice.id));
      await tx.update(payments).set({ status: "failed" }).where(eq(payments.id, made.payment.id));
    });
    return { error: "Halaman pembayaran tidak bisa dibuat saat ini. Coba lagi sebentar lagi." };
  }

  await withTenant(tenant.id, (tx) => tx.update(payments)
    .set({ snapToken: snap.token, redirectUrl: snap.redirectUrl }).where(eq(payments.id, made.payment.id)));
  redirect(snap.redirectUrl);
}
