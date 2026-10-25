import { desc, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { withTenant } from "@/db";
import { bookings, invoices, services } from "@/db/schema";
import { rupiah } from "@/lib/money";
import { requireSalon } from "@/lib/session";
import { formatDate } from "@/lib/time";

export const metadata = { title: "Invoice" };

export default async function Invoices() {
  const { tenant } = await requireSalon();
  const rows = await withTenant(tenant.id, (tx) => tx.select({ i: invoices, service: services.name })
    .from(invoices)
    .innerJoin(bookings, eq(bookings.id, invoices.bookingId))
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .where(isNotNull(invoices.number))
    .orderBy(desc(invoices.issuedAt)).limit(200));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Invoice</h1>
      <p className="text-sm text-stone-500">Nomor invoice diberikan saat pembayaran pertama masuk, berurutan tanpa celah per tahun.</p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 text-left text-stone-500">
            <tr><th className="p-3">Nomor</th><th className="p-3">Tanggal</th><th className="p-3">Pelanggan</th><th className="p-3">Layanan</th>
              <th className="p-3 text-right">Total</th><th className="p-3 text-right">Dibayar</th><th className="p-3">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map(({ i, service }) => (
              <tr key={i.id}>
                <td className="p-3 font-mono"><Link href={`/dashboard/invoices/${i.id}`} className="text-teal-700 hover:underline">{i.number}</Link></td>
                <td className="p-3">{formatDate(i.issuedAt!, tenant.timezone)}</td>
                <td className="p-3">{i.billName}</td>
                <td className="p-3">{service}</td>
                <td className="p-3 text-right">{rupiah(i.total)}</td>
                <td className="p-3 text-right">{rupiah(i.amountPaid)}</td>
                <td className="p-3"><Badge status={i.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-5 text-sm text-stone-500">Belum ada invoice.</p>}
      </Card>
    </div>
  );
}
