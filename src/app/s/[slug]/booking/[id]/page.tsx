import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, LinkButton } from "@/components/ui";
import { bookingView, tenantBySlug } from "@/lib/booking";
import { rupiah } from "@/lib/money";
import { reconcile } from "@/lib/payments";
import { formatDate, formatTime } from "@/lib/time";

export const metadata = { title: "Status booking" };

export default async function BookingStatus({ params }: PageProps<"/s/[slug]/booking/[id]">) {
  const { slug, id } = await params;
  const tenant = await tenantBySlug(slug);
  if (!tenant || !/^[0-9a-f-]{36}$/.test(id)) notFound();

  let view = await bookingView(tenant, id);
  if (!view) notFound();
  // The customer usually lands here straight from Midtrans, often before the
  // notification arrives (or without one, locally): ask Midtrans directly.
  const open = view.payments.filter((p) => p.status === "pending");
  if (open.length) {
    await Promise.all(open.map((p) => reconcile(p.orderId).catch((e) => console.error("reconcile", p.orderId, e))));
    view = (await bookingView(tenant, id))!;
  }
  const { booking, service, staffName, customer, invoice, payments } = view;
  const pay = payments.at(-1);
  const holdActive = booking.status === "pending_payment" && booking.holdUntil && booking.holdUntil > new Date();

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10">
      <Link href={`/s/${slug}`} className="text-sm text-teal-700 hover:underline">← {tenant.name}</Link>
      <Card className="mt-3 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Booking {service.name}</h1>
          <Badge status={booking.status} />
        </div>
        <dl className="grid grid-cols-3 gap-y-2 text-sm">
          <dt className="text-stone-500">Waktu</dt>
          <dd className="col-span-2">{formatDate(booking.startsAt, tenant.timezone)}, {formatTime(booking.startsAt, tenant.timezone)}</dd>
          <dt className="text-stone-500">Dengan</dt><dd className="col-span-2">{staffName}</dd>
          <dt className="text-stone-500">Atas nama</dt><dd className="col-span-2">{customer.name}</dd>
          <dt className="text-stone-500">Total</dt><dd className="col-span-2">{rupiah(invoice.total)}</dd>
          <dt className="text-stone-500">Sudah dibayar</dt><dd className="col-span-2">{rupiah(invoice.amountPaid)}</dd>
          {invoice.number && <><dt className="text-stone-500">Invoice</dt><dd className="col-span-2 font-mono">{invoice.number}</dd></>}
        </dl>

        {booking.status === "confirmed" && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Pembayaran diterima. Sampai jumpa{invoice.amountPaid < invoice.total && `; sisa ${rupiah(invoice.total - invoice.amountPaid)} dibayar di salon`}.
          </p>
        )}
        {holdActive && pay?.redirectUrl && (
          <div className="space-y-2">
            <p className="text-sm text-stone-600">Slot ditahan sampai {formatTime(booking.holdUntil!, tenant.timezone)}.</p>
            <LinkButton href={pay.redirectUrl} className="w-full">Lanjutkan pembayaran</LinkButton>
          </div>
        )}
        {booking.status === "cancelled" && (
          <div className="space-y-2">
            <p className="text-sm text-stone-600">Booking ini batal karena pembayaran tidak selesai.</p>
            <LinkButton href={`/s/${slug}/book?service=${service.id}`} variant="ghost" className="w-full">Booking ulang</LinkButton>
          </div>
        )}
      </Card>
    </main>
  );
}
