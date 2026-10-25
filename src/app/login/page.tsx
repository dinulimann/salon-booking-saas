import Link from "next/link";
import { Card } from "@/components/ui";
import { LoginForm } from "../auth-forms";

export const metadata = { title: "Masuk" };

export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-semibold">Masuk ke dashboard</h1>
      <Card><LoginForm /></Card>
      <p className="mt-4 text-sm text-stone-600">Belum punya akun? <Link href="/signup" className="text-teal-700 hover:underline">Daftarkan salon</Link></p>
    </main>
  );
}
