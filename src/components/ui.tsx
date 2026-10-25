import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Button({ variant = "primary", className, ...p }: ComponentProps<"button"> & { variant?: "primary" | "ghost" | "danger" }) {
  return <button {...p} className={cx(
    "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50",
    variant === "primary" && "bg-teal-700 text-white hover:bg-teal-800",
    variant === "ghost" && "border border-stone-300 bg-white hover:bg-stone-100",
    variant === "danger" && "border border-red-200 bg-white text-red-700 hover:bg-red-50",
    className)} />;
}

export function LinkButton({ variant = "primary", className, ...p }: ComponentProps<typeof Link> & { variant?: "primary" | "ghost" }) {
  return <Link {...p} className={cx(
    "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition",
    variant === "primary" ? "bg-teal-700 text-white hover:bg-teal-800" : "border border-stone-300 bg-white hover:bg-stone-100",
    className)} />;
}

export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div {...p} className={cx("rounded-xl border border-stone-200 bg-white p-5 shadow-sm", className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

export const inputClass = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20";

export function Input(p: ComponentProps<"input">) {
  return <input {...p} className={cx(inputClass, p.className)} />;
}

const tones: Record<string, string> = {
  confirmed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  paid: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  completed: "bg-stone-100 text-stone-700 ring-stone-200",
  deposit_paid: "bg-sky-50 text-sky-800 ring-sky-200",
  pending_payment: "bg-amber-50 text-amber-800 ring-amber-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  unpaid: "bg-amber-50 text-amber-800 ring-amber-200",
  cancelled: "bg-stone-100 text-stone-500 ring-stone-200",
  void: "bg-stone-100 text-stone-500 ring-stone-200",
  expired: "bg-stone-100 text-stone-500 ring-stone-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
  no_show: "bg-red-50 text-red-700 ring-red-200",
  refund: "bg-red-50 text-red-700 ring-red-200",
};

export const statusLabel: Record<string, string> = {
  confirmed: "Terkonfirmasi", completed: "Selesai", pending_payment: "Menunggu pembayaran", cancelled: "Dibatalkan",
  no_show: "Tidak datang", paid: "Lunas", deposit_paid: "DP dibayar", unpaid: "Belum dibayar", void: "Batal",
  pending: "Menunggu", failed: "Gagal", expired: "Kedaluwarsa", refunded: "Dikembalikan", refund: "Perlu refund",
};

export function Badge({ status }: { status: string }) {
  return <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
    tones[status] ?? "bg-stone-100 text-stone-700 ring-stone-200")}>{statusLabel[status] ?? status}</span>;
}
