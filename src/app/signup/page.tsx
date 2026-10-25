import Link from "next/link";
import { Card } from "@/components/ui";
import { SignupForm } from "../auth-forms";

export const metadata = { title: "Daftar" };

export default function SignupPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Daftarkan salon Anda</h1>
      <Card><SignupForm /></Card>
      <p className="mt-4 text-sm text-stone-600">Sudah punya akun? <Link href="/login" className="text-teal-700 hover:underline">Masuk</Link></p>
    </main>
  );
}
