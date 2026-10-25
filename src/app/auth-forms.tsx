"use client";

import { useActionState } from "react";
import { Button, Field, Input } from "@/components/ui";
import { login, signup, type FormState } from "./auth-actions";

function ErrorText({ state }: { state: FormState }) {
  return state.error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null;
}

export function LoginForm() {
  const [state, action, pending] = useActionState(login, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Password"><Input name="password" type="password" required autoComplete="current-password" /></Field>
      <ErrorText state={state} />
      <Button type="submit" disabled={pending} className="w-full">Masuk</Button>
    </form>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, {});
  return (
    <form action={action} className="space-y-4">
      <Field label="Nama Anda"><Input name="name" required autoComplete="name" /></Field>
      <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Password" hint="Minimal 8 karakter"><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
      <Field label="Nama salon"><Input name="salon" required /></Field>
      <Field label="Alamat halaman booking" hint="Pelanggan memesan di /s/alamat-ini">
        <Input name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,40}" placeholder="barbershop-kumis" />
      </Field>
      <ErrorText state={state} />
      <Button type="submit" disabled={pending} className="w-full">Buat akun salon</Button>
    </form>
  );
}
