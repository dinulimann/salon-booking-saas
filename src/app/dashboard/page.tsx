import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import Link from "next/link";
import { Badge, Button, Card } from "@/components/ui";
import { withTenant } from "@/db";
import { bookings, customers, invoices, payments, services, staff } from "@/db/schema";
import { rupiah } from "@/lib/money";
import { requireSalon } from "@/lib/session";
import { addDays, formatDate, formatTime, localDate, localToUtc } from "@/lib/time";
import { setBookingStatus, settleAtCounter } from "./actions";

export const metadata = { title: "Jadwal" };

export default async function Schedule({ searchParams }: PageProps<"/dashboard">) {
  const { tenant } = await requireSalon();
  const tz = tenant.timezone;
  const q = await searchParams;
  const today = localDate(new Date(), tz);
  const date = typeof q.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? q.date : today;
  const from = localToUtc(date, 0, tz), to = localToUtc(addDays(date, 1), 0, tz);
  const monthStart = localToUtc(today.slice(0, 8) + "01", 0, tz);

  const data = await withTenant(tenant.id, async (tx) => {
    const day = await tx.select({ b: bookings, service: services.name, staff: staff.name, customer: customers, invoice: invoices })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.serviceId))
      .innerJoin(staff, eq(staff.id, bookings.staffId))
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .innerJoin(invoices, eq(invoices.bookingId, bookings.id))
      .where(and(gte(bookings.startsAt, from), lt(bookings.startsAt, to)))
      .orderBy(asc(bookings.startsAt));
    // Paid, but the booking could not be kept (paid after its hold expired and the slot was re-booked)
    const refunds = await tx.select({ orderId: payments.orderId, amount: payments.amount, customer: customers.name, startsAt: bookings.startsAt })
      .from(payments)
      .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
      .innerJoin(bookings, eq(bookings.id, invoices.bookingId))
      .innerJoin(customers, eq(customers.id, bookings.customerId))
      .where(and(eq(payments.status, "paid"), eq(bookings.status, "cancelled")));
    const [month] = await tx.select({ paid: sql<number>`coalesce(sum(${payments.amount}), 0)::int` })
      .from(payments).where(and(eq(payments.status, "paid"), gte(payments.paidAt, monthStart)));
    return { day, refunds, monthPaid: month.paid };
  });
  const active = data.day.filter((r) => r.b.status !== "cancelled");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{formatDate(localToUtc(date, 720, tz), tz)}</h1>
          <p className="text-sm text-stone-500">{active.length} booking · pembayaran online bulan ini {rupiah(data.monthPaid)}</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link className="rounded-lg border border-stone-300 bg-white px-3 py-1.5" href={`/dashboard?date=${addDays(date, -1)}`}>←</Link>
          <Link className="rounded-lg border border-stone-300 bg-white px-3 py-1.5" href="/dashboard">Hari ini</Link>
          <Link className="rounded-lg border border-stone-300 bg-white px-3 py-1.5" href={`/dashboard?date=${addDays(date, 1)}`}>→</Link>
        </div>
      </div>

      {data.refunds.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <h2 className="font-medium text-red-800">Perlu refund</h2>
          <p className="text-sm text-red-700">Dibayar setelah slot dilepas dan sudah diambil pelanggan lain. Refund lewat dashboard Midtrans.</p>
          <ul className="mt-2 text-sm text-red-800">
            {data.refunds.map((r) => <li key={r.orderId}>{r.orderId} · {r.customer} · {rupiah(r.amount)} · {formatDate(r.startsAt, tz)}</li>)}
          </ul>
        </Card>
      )}

      {data.day.length === 0 ? (
        <Card><p className="text-sm text-stone-500">Belum ada booking di hari ini.</p></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b border-stone-200 text-left text-stone-500">
              <tr><th className="p-3">Jam</th><th className="p-3">Staf</th><th className="p-3">Pelanggan</th><th className="p-3">Layanan</th>
                <th className="p-3">Status</th><th className="p-3">Pembayaran</th><th className="p-3"></th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.day.map(({ b, service, staff: who, customer, invoice }) => (
                <tr key={b.id} className={b.status === "cancelled" ? "text-stone-400" : ""}>
                  <td className="p-3 font-mono">{formatTime(b.startsAt, tz)}–{formatTime(b.endsAt, tz)}</td>
                  <td className="p-3">{who}</td>
                  <td className="p-3">{customer.name}<div className="text-xs text-stone-400">{customer.phone}</div></td>
                  <td className="p-3">{service}</td>
                  <td className="p-3"><Badge status={b.status} /></td>
                  <td className="p-3">
                    <Link href={`/dashboard/invoices/${invoice.id}`} className="hover:underline"><Badge status={invoice.status} /></Link>
                    <div className="text-xs text-stone-400">{rupiah(invoice.amountPaid)} / {rupiah(invoice.total)}</div>
                  </td>
                  <td className="space-x-1 whitespace-nowrap p-3 text-right">
                    {b.status === "confirmed" && invoice.amountPaid < invoice.total && (
                      <form action={settleAtCounter.bind(null, invoice.id)} className="inline">
                        <Button variant="ghost" className="px-2 py-1 text-xs">Lunasi di kasir</Button>
                      </form>
                    )}
                    {b.status === "confirmed" && (
                      <>
                        <form action={setBookingStatus.bind(null, b.id, "completed")} className="inline">
                          <Button variant="ghost" className="px-2 py-1 text-xs">Selesai</Button>
                        </form>
                        <form action={setBookingStatus.bind(null, b.id, "no_show")} className="inline">
                          <Button variant="danger" className="px-2 py-1 text-xs">Tidak datang</Button>
                        </form>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
