import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LinkButton } from "@/components/ui";
import { withTenant } from "@/db";
import { services } from "@/db/schema";
import { tenantBySlug } from "@/lib/booking";
import { rupiah } from "@/lib/money";

export const metadata: Metadata = { title: "Booking" };

export default async function SalonPage({ params }: PageProps<"/s/[slug]">) {
  const tenant = await tenantBySlug((await params).slug);
  if (!tenant) notFound();
  const list = await withTenant(tenant.id, (tx) =>
    tx.select().from(services).where(and(eq(services.active, true))).orderBy(asc(services.price)));

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">{tenant.name}</h1>
      {tenant.address && <p className="mt-1 text-stone-600">{tenant.address}</p>}
      <p className="mt-6 text-sm text-stone-600">
        Pilih layanan, lalu jam yang kosong. Pembayaran {tenant.depositPercent < 100 ? `DP ${tenant.depositPercent}%` : "penuh"} lewat
        Midtrans (QRIS, e-wallet, transfer bank, kartu); slot ditahan {tenant.holdMinutes} menit sampai dibayar.
      </p>
      <ul className="mt-6 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
        {list.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 p-4">
            <div>
              <p className="font-medium">{s.name}</p>
              <p className="text-sm text-stone-500">{s.durationMin} menit · {rupiah(s.price)}</p>
            </div>
            <LinkButton href={`/s/${tenant.slug}/book?service=${s.id}`}>Pilih</LinkButton>
          </li>
        ))}
      </ul>
    </main>
  );
}
