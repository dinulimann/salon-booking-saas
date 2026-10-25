"use client";

import { useActionState } from "react";
import { Button, Field, Input, inputClass } from "@/components/ui";
import { book, type BookState } from "./actions";

export function BookingForm(p: { slug: string; serviceId: string; startsAt: string; staff: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<BookState, FormData>(book, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="slug" value={p.slug} />
      <input type="hidden" name="serviceId" value={p.serviceId} />
      <input type="hidden" name="startsAt" value={p.startsAt} />
      <Field label="Dengan siapa">
        <select name="staffId" className={inputClass} defaultValue="">
          <option value="">Siapa saja yang kosong</option>
          {p.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Nama"><Input name="name" required autoComplete="name" /></Field>
      <Field label="Nomor HP (WhatsApp)"><Input name="phone" required inputMode="tel" autoComplete="tel" placeholder="0812 3456 7890" /></Field>
      <Field label="Email" hint="Opsional, untuk bukti pembayaran dari Midtrans"><Input name="email" type="email" autoComplete="email" /></Field>
      <Field label="Catatan" hint="Opsional"><Input name="note" maxLength={300} /></Field>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
      <Button type="submit" disabled={pending} className="w-full">{pending ? "Membuat pembayaran…" : "Lanjut ke pembayaran"}</Button>
    </form>
  );
}
