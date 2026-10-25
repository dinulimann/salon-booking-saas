"use server";

import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, withTenant } from "@/db";
import { memberships, staff, tenants, workingHours } from "@/db/schema";
import { auth } from "@/lib/auth";

export type FormState = { error?: string };

const Signup = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 huruf"),
  email: z.email("Email tidak valid"),
  password: z.string().min(8, "Password minimal 8 karakter"),
  salon: z.string().trim().min(2, "Nama salon minimal 2 huruf").max(80),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Alamat hanya huruf kecil, angka dan tanda hubung"),
});

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const p = Signup.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  const [taken] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, v.slug));
  if (taken) return { error: `Alamat /s/${v.slug} sudah dipakai` };

  let userId: string;
  try {
    const res = await auth.api.signUpEmail({ body: { name: v.name, email: v.email, password: v.password }, headers: await headers() });
    userId = res.user.id;
  } catch (e) {
    if (e instanceof APIError) return { error: e.message === "User already exists. Use another email." ? "Email sudah terdaftar" : e.message };
    throw e;
  }

  const [tenant] = await db.insert(tenants).values({ slug: v.slug, name: v.salon }).returning();
  await withTenant(tenant.id, async (tx) => {
    await tx.insert(memberships).values({ tenantId: tenant.id, userId, role: "owner" });
    // The owner as the first staff member, Monday to Saturday 09:00-18:00
    const [me] = await tx.insert(staff).values({ tenantId: tenant.id, name: v.name }).returning();
    await tx.insert(workingHours).values([1, 2, 3, 4, 5, 6].map((weekday) =>
      ({ tenantId: tenant.id, staffId: me.id, weekday, startMin: 540, endMin: 1080 })));
  });
  redirect("/dashboard/services");
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  try {
    await auth.api.signInEmail({
      body: { email: String(form.get("email")), password: String(form.get("password")) }, headers: await headers(),
    });
  } catch (e) {
    if (e instanceof APIError) return { error: "Email atau password salah" };
    throw e;
  }
  redirect("/dashboard");
}

export async function logout() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
