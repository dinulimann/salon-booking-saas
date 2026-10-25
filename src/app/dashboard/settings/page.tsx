import { Button, Card, Field, Input } from "@/components/ui";
import { requireSalon } from "@/lib/session";
import { saveSettings } from "../actions";

export const metadata = { title: "Pengaturan" };

export default async function Settings() {
  const { tenant } = await requireSalon();
  return (
    <Card className="max-w-xl">
      <h1 className="mb-4 text-xl font-semibold">Pengaturan salon</h1>
      <form action={saveSettings} className="space-y-4">
        <Field label="Nama salon"><Input name="name" defaultValue={tenant.name} required /></Field>
        <Field label="Alamat"><Input name="address" defaultValue={tenant.address ?? ""} /></Field>
        <Field label="Telepon"><Input name="phone" defaultValue={tenant.phone ?? ""} /></Field>
        <Field label="PPN (%)" hint="0 jika belum PKP"><Input name="taxPercent" type="number" step="0.01" min={0} max={20} defaultValue={tenant.taxRateBp / 100} /></Field>
        <Field label="Dibayar online saat booking (%)" hint="100 = lunas di muka; 50 = DP 50%, sisanya di kasir">
          <Input name="depositPercent" type="number" min={10} max={100} defaultValue={tenant.depositPercent} />
        </Field>
        <Field label="Batas waktu bayar (menit)" hint="Slot ditahan selama ini; tidak dibayar = dilepas">
          <Input name="holdMinutes" type="number" min={5} max={60} defaultValue={tenant.holdMinutes} />
        </Field>
        <p className="text-sm text-stone-500">Halaman booking: <span className="font-mono">/s/{tenant.slug}</span></p>
        <Button type="submit">Simpan</Button>
      </form>
    </Card>
  );
}
