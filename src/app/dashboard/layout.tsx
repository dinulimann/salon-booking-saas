import Link from "next/link";
import { Suspense } from "react";
import { requireSalon } from "@/lib/session";
import { logout } from "../auth-actions";

const nav = [
  ["/dashboard", "Jadwal"], ["/dashboard/invoices", "Invoice"], ["/dashboard/services", "Layanan"],
  ["/dashboard/staff", "Staf"], ["/dashboard/settings", "Pengaturan"],
] as const;

// The navigation is static; the salon name and account read the session at
// request time, so they stream in behind Suspense (Cache Components).
async function Account() {
  const { tenant, user } = await requireSalon();
  return (
    <>
      <span className="order-first font-semibold">{tenant.name}</span>
      <div className="ml-auto flex items-center gap-3 text-sm text-stone-500">
        <Link href={`/s/${tenant.slug}`} className="text-teal-700 hover:underline" target="_blank">Halaman booking ↗</Link>
        <span>{user.email}</span>
        <form action={logout}><button className="hover:text-stone-900">Keluar</button></form>
      </div>
    </>
  );
}

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="no-print border-b border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <nav className="flex flex-wrap gap-4 text-sm">
            {nav.map(([href, label]) => <Link key={href} href={href} className="text-stone-600 hover:text-stone-900">{label}</Link>)}
          </nav>
          <Suspense fallback={<span className="ml-auto h-4 w-48 animate-pulse rounded bg-stone-200" />}><Account /></Suspense>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
