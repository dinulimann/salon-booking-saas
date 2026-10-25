import { and, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { withTenant } from "@/db";
import { services, staff } from "@/db/schema";
import { slotsFor, tenantBySlug } from "@/lib/booking";
import { invoiceAmounts, rupiah } from "@/lib/money";
import { addDays, formatDate, formatTime, localDate, localToUtc } from "@/lib/time";
import { BookingForm } from "./booking-form";

export const metadata = { title: "Pilih jadwal" };
const DAYS = 14;

export default async function BookPage({ params, searchParams }: PageProps<"/s/[slug]/book">) {
  const { slug } = await params;
  const q = await searchParams;
  const tenant = await tenantBySlug(slug);
  const serviceId = typeof q.service === "string" ? q.service : "";
  if (!tenant || !/^[0-9a-f-]{36}$/.test(serviceId)) notFound();

  const today = localDate(new Date(), tenant.timezone);
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today;
  const time = typeof q.time === "string" ? q.time : null;

  const data = await withTenant(tenant.id, async (tx) => {
    const [service] = await tx.select().from(services).where(and(eq(services.id, serviceId), eq(services.active, true)));
    if (!service) return null;
    const slots = await slotsFor(tx, tenant, service.id, date);
    const chosen = time ? slots.find((s) => s.start.toISOString() === time) : undefined;
    const who = chosen ? await tx.select({ id: staff.id, name: staff.name }).from(staff).where(inArray(staff.id, chosen.staffIds)) : [];
    return { service, slots, chosen, who };
  });
  if (!data) notFound();
  const { service, slots, chosen, who } = data;
  const amounts = invoiceAmounts(service.price, tenant.taxRateBp, tenant.depositPercent);
  const base = `/s/${slug}/book?service=${service.id}`;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Link href={`/s/${slug}`} className="text-sm text-teal-700 hover:underline">← {tenant.name}</Link>
      <h1 className="mt-2 text-2xl font-semibold">{service.name}</h1>
      <p className="text-stone-600">{service.durationMin} menit · {rupiah(amounts.total)}{amounts.tax > 0 && " termasuk PPN"}</p>

      <nav className="mt-6 flex gap-2 overflow-x-auto pb-2" aria-label="Tanggal">
        {Array.from({ length: DAYS }, (_, i) => addDays(today, i)).map((d) => {
          const label = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", timeZone: "UTC" })
            .format(new Date(d + "T00:00:00Z"));
          return (
            <Link key={d} href={`${base}&date=${d}`} className={`shrink-0 rounded-lg border px-3 py-2 text-sm ${
              d === date ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white hover:bg-stone-100"}`}>
              {label}
            </Link>
          );
        })}
      </nav>

      <h2 className="mt-6 font-medium">{formatDate(localToUtc(date, 12 * 60, tenant.timezone), tenant.timezone)}</h2>
      {slots.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">Tidak ada jam kosong di hari ini. Coba tanggal lain.</p>
      ) : (
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6" data-testid="slots">
          {slots.map((s) => {
            const iso = s.start.toISOString();
            return (
              <Link key={iso} href={`${base}&date=${date}&time=${encodeURIComponent(iso)}`}
                className={`rounded-lg border px-2 py-2 text-center text-sm ${
                  iso === time ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white hover:bg-stone-100"}`}>
                {formatTime(s.start, tenant.timezone)}
              </Link>
            );
          })}
        </div>
      )}

      {chosen && (
        <Card className="mt-8">
          <p className="mb-4 text-sm text-stone-600">
            {formatDate(chosen.start, tenant.timezone)}, {formatTime(chosen.start, tenant.timezone)}–{formatTime(chosen.end, tenant.timezone)}.
            Dibayar sekarang: <strong>{rupiah(amounts.depositDue)}</strong>
            {amounts.depositDue < amounts.total && <> (sisa {rupiah(amounts.total - amounts.depositDue)} di salon)</>}.
          </p>
          <BookingForm slug={slug} serviceId={service.id} startsAt={chosen.start.toISOString()} staff={who} />
        </Card>
      )}
    </main>
  );
}
