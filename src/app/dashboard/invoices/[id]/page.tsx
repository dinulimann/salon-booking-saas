import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { withTenant } from "@/db";
import { bookings, invoices, payments, services, staff } from "@/db/schema";
import { rupiah } from "@/lib/money";
import { requireSalon } from "@/lib/session";
import { formatDate, formatTime } from "@/lib/time";
import { PrintButton } from "./print-button";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: PageProps<"/dashboard/invoices/[id]">) {
  const { id } = await params;
  const { tenant } = await requireSalon();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  // Another salon's invoice id simply matches no row here (Row Level Security).
  const data = await withTenant(tenant.id, async (tx) => {
    const [row] = await tx.select({ i: invoices, b: bookings, service: services.name, staff: staff.name })
      .from(invoices)
      .innerJoin(bookings, eq(bookings.id, invoices.bookingId))
      .innerJoin(services, eq(services.id, bookings.serviceId))
      .innerJoin(staff, eq(staff.id, bookings.staffId))
      .where(eq(invoices.id, id));
    if (!row) return null;
    const pays = await tx.select().from(payments).where(eq(payments.invoiceId, id)).orderBy(asc(payments.createdAt));
    return { ...row, pays };
  });
  if (!data) notFound();
  const { i, b, service, staff: who, pays } = data;
  const tz = tenant.timezone;

  return (
    <div className="space-y-4">
      <div className="no-print flex justify-end"><PrintButton /></div>
      <Card className="mx-auto max-w-2xl space-y-6 p-8">
        <div className="flex justify-between gap-6">
          <div>
            <p className="text-lg font-semibold">{tenant.name}</p>
            {tenant.address && <p className="text-sm text-stone-600">{tenant.address}</p>}
            {tenant.phone && <p className="text-sm text-stone-600">{tenant.phone}</p>}
          </div>
          <div className="text-right">
            <p className="text-sm uppercase tracking-wide text-stone-500">Invoice</p>
            <p className="font-mono text-lg">{i.number ?? "belum terbit"}</p>
            {i.issuedAt && <p className="text-sm text-stone-600">{formatDate(i.issuedAt, tz)}</p>}
            <div className="mt-1"><Badge status={i.status} /></div>
          </div>
        </div>
        <div className="text-sm">
          <p className="text-stone-500">Kepada</p>
          <p className="font-medium">{i.billName}</p>
          <p className="text-stone-600">{i.billPhone}{i.billEmail && ` · ${i.billEmail}`}</p>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-stone-200 text-left text-stone-500"><tr><th className="py-2">Layanan</th><th className="py-2 text-right">Jumlah</th></tr></thead>
          <tbody>
            <tr className="border-b border-stone-100">
              <td className="py-2">{service} · {who}<div className="text-xs text-stone-500">{formatDate(b.startsAt, tz)}, {formatTime(b.startsAt, tz)}</div></td>
              <td className="py-2 text-right">{rupiah(i.subtotal)}</td>
            </tr>
          </tbody>
          <tfoot className="text-right">
            {i.tax > 0 && <tr><td className="pt-2 text-stone-500">PPN {tenant.taxRateBp / 100}%</td><td className="pt-2">{rupiah(i.tax)}</td></tr>}
            <tr className="font-semibold"><td className="pt-2">Total</td><td className="pt-2">{rupiah(i.total)}</td></tr>
            <tr><td className="text-stone-500">Dibayar</td><td>{rupiah(i.amountPaid)}</td></tr>
            <tr className="font-semibold"><td>Sisa</td><td>{rupiah(i.total - i.amountPaid)}</td></tr>
          </tfoot>
        </table>
        <div className="text-sm">
          <p className="mb-1 text-stone-500">Riwayat pembayaran</p>
          <ul className="space-y-1">
            {pays.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span className="font-mono text-xs">{p.orderId} · {p.paymentType ?? "Midtrans"}</span>
                <span>{rupiah(p.amount)} <Badge status={p.status} /></span>
              </li>
            ))}
            {i.amountPaid > pays.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0) && (
              <li className="flex justify-between"><span className="text-xs">Kasir</span><span>{rupiah(i.amountPaid - pays.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0))}</span></li>
            )}
          </ul>
        </div>
      </Card>
    </div>
  );
}
