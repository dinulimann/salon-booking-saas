import { createHash, timingSafeEqual } from "node:crypto";

// Midtrans Snap (redirect mode) and the Core API status endpoint.
// https://docs.midtrans.com/reference/snap-api  and  .../get-transaction-status

const sandbox = process.env.MIDTRANS_IS_PRODUCTION !== "true";
export const SNAP_URL = process.env.MIDTRANS_SNAP_URL
  ?? (sandbox ? "https://app.sandbox.midtrans.com/snap/v1" : "https://app.midtrans.com/snap/v1");
export const API_URL = process.env.MIDTRANS_API_URL
  ?? (sandbox ? "https://api.sandbox.midtrans.com/v2" : "https://api.midtrans.com/v2");

function serverKey(): string {
  const key = process.env.MIDTRANS_SERVER_KEY;
  if (!key) throw new Error("MIDTRANS_SERVER_KEY is not set");
  return key;
}

function headers() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: "Basic " + Buffer.from(serverKey() + ":").toString("base64"),
  };
}

export type SnapRequest = {
  orderId: string;
  amount: number;
  item: { id: string; name: string };
  customer: { name: string; phone: string; email?: string | null };
  finishUrl: string;
  expiryMinutes: number;
};

export async function createSnapTransaction(req: SnapRequest): Promise<{ token: string; redirectUrl: string }> {
  const res = await fetch(`${SNAP_URL}/transactions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      transaction_details: { order_id: req.orderId, gross_amount: req.amount },
      // item_details must add up to gross_amount exactly
      item_details: [{ id: req.item.id, name: req.item.name.slice(0, 50), price: req.amount, quantity: 1 }],
      customer_details: { first_name: req.customer.name, phone: req.customer.phone, email: req.customer.email ?? undefined },
      callbacks: { finish: req.finishUrl },
      expiry: { unit: "minutes", duration: req.expiryMinutes },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) {
    throw new Error(`Midtrans Snap ${res.status}: ${JSON.stringify(body.error_messages ?? body).slice(0, 300)}`);
  }
  return { token: body.token, redirectUrl: body.redirect_url };
}

export type MidtransStatus = {
  order_id: string;
  status_code: string;
  gross_amount: string;
  transaction_status?: string;
  fraud_status?: string;
  payment_type?: string;
  signature_key?: string;
  settlement_time?: string;
  [k: string]: unknown;
};

/** Asks Midtrans directly; used to confirm a notification and when the customer returns. */
export async function getStatus(orderId: string): Promise<MidtransStatus | null> {
  const res = await fetch(`${API_URL}/${encodeURIComponent(orderId)}/status`, { headers: headers(), cache: "no-store" });
  const body = (await res.json().catch(() => null)) as MidtransStatus | null;
  if (!body || body.status_code === "404") return null;
  return body;
}

/** signature_key = SHA512(order_id + status_code + gross_amount + server key), compared in constant time. */
export function verifySignature(n: Pick<MidtransStatus, "order_id" | "status_code" | "gross_amount" | "signature_key">,
                                key = serverKey()): boolean {
  if (!n.signature_key || !n.order_id || !n.status_code || !n.gross_amount) return false;
  const expected = createHash("sha512").update(n.order_id + n.status_code + n.gross_amount + key).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(n.signature_key));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signature(orderId: string, statusCode: string, grossAmount: string, key: string): string {
  return createHash("sha512").update(orderId + statusCode + grossAmount + key).digest("hex");
}

export type PaymentState = "pending" | "paid" | "failed" | "expired" | "refunded";

/** Midtrans transaction_status (+ fraud_status for cards) -> our payment state. */
export function toPaymentState(transactionStatus?: string, fraudStatus?: string): PaymentState | null {
  switch (transactionStatus) {
    case "settlement": return "paid";
    case "capture": return fraudStatus === "accept" || fraudStatus === undefined ? "paid" : "pending";
    case "pending": return "pending";
    case "deny": case "cancel": case "failure": return "failed";
    case "expire": return "expired";
    case "refund": case "partial_refund": return "refunded";
    default: return null;
  }
}

/** Notifications can arrive late, twice, or out of order: only forward moves are applied. */
export function canTransition(from: PaymentState, to: PaymentState): boolean {
  if (from === to) return false;
  if (from === "pending") return to !== "refunded";
  if (from === "paid") return to === "refunded";
  return false; // failed, expired and refunded are final
}
