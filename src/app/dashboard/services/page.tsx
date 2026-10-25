import { asc } from "drizzle-orm";
import { Button, Card, Field, Input } from "@/components/ui";
import { withTenant } from "@/db";
import { services } from "@/db/schema";
import { rupiah } from "@/lib/money";
import { requireSalon } from "@/lib/session";
import { addService, toggleService } from "../actions";

export const metadata = { title: "Layanan" };

export default async function Services() {
  const { tenant } = await requireSalon();
  const list = await withTenant(tenant.id, (tx) => tx.select().from(services).orderBy(asc(services.name)));
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Layanan</h1>
        <Card className="divide-y divide-stone-100 p-0">
          {list.map((s) => (
            <div key={s.id} className={`flex items-center justify-between p-4 ${s.active ? "" : "text-stone-400"}`}>
              <div><p className="font-medium">{s.name}</p><p className="text-sm">{s.durationMin} menit · {rupiah(s.price)}</p></div>
              <form action={toggleService.bind(null, s.id, !s.active)}>
                <Button variant="ghost" className="text-xs">{s.active ? "Nonaktifkan" : "Aktifkan"}</Button>
              </form>
            </div>
          ))}
          {list.length === 0 && <p className="p-4 text-sm text-stone-500">Tambahkan layanan pertama Anda agar pelanggan bisa booking.</p>}
        </Card>
      </div>
      <Card className="h-fit">
        <h2 className="mb-4 font-medium">Tambah layanan</h2>
        <form action={addService} className="space-y-3">
          <Field label="Nama"><Input name="name" required placeholder="Potong rambut" /></Field>
          <Field label="Durasi (menit)"><Input name="durationMin" type="number" min={5} step={5} defaultValue={30} required /></Field>
          <Field label="Harga (Rp)"><Input name="price" type="number" min={0} step={1000} required /></Field>
          <Button type="submit" className="w-full">Simpan</Button>
        </form>
      </Card>
    </div>
  );
}
