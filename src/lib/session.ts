import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { tenants } from "@/db/schema";
import { auth } from "./auth";

export async function currentUser() {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.user ?? null;
}

/** The signed-in user and their salon; redirects to /login otherwise. */
export async function requireSalon() {
  const user = await currentUser();
  if (!user) redirect("/login");
  // memberships is tenant-scoped; this SECURITY DEFINER lookup finds the user's salons
  const rows = await db.execute<{ tenant_id: string; role: "owner" | "staff" }>(
    sql`select tenant_id, role from tenants_of_user(${user.id})`);
  if (!rows.length) redirect("/signup");
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, rows[0].tenant_id));
  return { user, tenant, role: rows[0].role };
}
