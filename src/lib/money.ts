// Rupiah amounts are integers throughout (Midtrans also takes IDR as integers).

export type InvoiceAmounts = { subtotal: number; tax: number; total: number; depositDue: number };

/**
 * taxRateBp: PPN in basis points (1100 = 11%). depositPercent: share of the
 * total paid online at booking (100 = pay in full). Tax and deposit are
 * rounded half up to whole rupiah; the deposit never exceeds the total.
 */
export function invoiceAmounts(price: number, taxRateBp: number, depositPercent: number): InvoiceAmounts {
  if (!Number.isInteger(price) || price < 0) throw new Error("price must be whole rupiah");
  const tax = Math.floor((price * taxRateBp + 5000) / 10000);
  const total = price + tax;
  const depositDue = depositPercent >= 100 ? total : Math.min(total, Math.floor((total * depositPercent + 50) / 100));
  return { subtotal: price, tax, total, depositDue };
}

export function rupiah(amount: number): string {
  return "Rp" + new Intl.NumberFormat("id-ID").format(amount);
}

/** Invoice number for the n-th invoice of a salon in a year: INV/2026/0007. */
export function invoiceNumber(year: number, n: number): string {
  return `INV/${year}/${String(n).padStart(4, "0")}`;
}
