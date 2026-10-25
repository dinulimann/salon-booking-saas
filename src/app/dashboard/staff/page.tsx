import { asc } from "drizzle-orm";
import { Button, Card, Field, Input } from "@/components/ui";
import { withTenant } from "@/db";
import { staff, workingHours } from "@/db/schema";
import { requireSalon } from "@/lib/session";
import { addStaff, saveHours, toggleStaff } from "../actions";

export const metadata = { title: "Staf" };
const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function Staff() {
  const { tenant } = await requireSalon();
  const { team, hours } = await withTenant(tenant.id, async (tx) => ({
    team: await tx.select().from(staff).orderBy(asc(staff.name)),
    hours: await tx.select().from(workingHours),
  }));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Staf & jam kerja</h1>
        <form action={addStaff} className="flex gap-2">
          <Input name="name" required placeholder="Nama staf baru" className="w-48" />
          <Button type="submit">Tambah</Button>
        </form>
      </div>
      {team.map((s) => (
        <Card key={s.id} className={s.active ? "" : "opacity-60"}>
          <div className="mb-3 flex items-center justify-between">
            <p className="font-medium">{s.name}</p>
            <form action={toggleStaff.bind(null, s.id, !s.active)}>
              <Button variant="ghost" className="text-xs">{s.active ? "Nonaktifkan" : "Aktifkan"}</Button>
            </form>
          </div>
          <form action={saveHours.bind(null, s.id)} className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {DAYS.map((label, d) => {
              const h = hours.find((x) => x.staffId === s.id && x.weekday === d);
              return (
                <Field key={d} label={label}>
                  <div className="space-y-1">
                    <Input name={`start_${d}`} type="time" step={900} defaultValue={h ? hhmm(h.startMin) : ""} aria-label={`${label} mulai`} />
                    <Input name={`end_${d}`} type="time" step={900} defaultValue={h ? hhmm(h.endMin) : ""} aria-label={`${label} selesai`} />
                  </div>
                </Field>
              );
            })}
            <div className="col-span-full"><Button variant="ghost" type="submit">Simpan jam kerja</Button></div>
          </form>
        </Card>
      ))}
    </div>
  );
}
