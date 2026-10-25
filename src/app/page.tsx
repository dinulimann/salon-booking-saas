import { LinkButton } from "@/components/ui";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-20">
      <p className="text-sm font-medium text-teal-700">Janjian</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Booking online, pembayaran, dan invoice untuk salon & barbershop.</h1>
      <ul className="mt-6 space-y-2 text-stone-600">
        <li>• Pelanggan memilih layanan, staf dan jam yang benar-benar kosong.</li>
        <li>• Bayar penuh atau DP lewat Midtrans (QRIS, e-wallet, VA, kartu); slot ditahan sampai dibayar.</li>
        <li>• Invoice bernomor otomatis, PPN opsional, pelunasan di kasir.</li>
        <li>• Satu aplikasi untuk banyak salon; data tiap salon terpisah di tingkat database.</li>
      </ul>
      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton href="/s/kumis">Coba booking (demo)</LinkButton>
        <LinkButton href="/login" variant="ghost">Masuk</LinkButton>
        <LinkButton href="/signup" variant="ghost">Daftarkan salon</LinkButton>
      </div>
    </main>
  );
}
