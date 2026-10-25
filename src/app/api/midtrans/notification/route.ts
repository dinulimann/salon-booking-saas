import { NextResponse } from "next/server";
import { db } from "@/db";
import { paymentEvents } from "@/db/schema";
import { getStatus, verifySignature, type MidtransStatus } from "@/lib/midtrans";
import { applyStatus } from "@/lib/payments";

/**
 * Midtrans HTTP notification. The signature proves the sender knows our
 * server key; the status is then re-read from Midtrans itself and that answer
 * is what gets applied. Midtrans retries on non-2xx, and applyStatus is
 * idempotent, so retries are harmless.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as MidtransStatus | null;
  if (!body?.order_id) return NextResponse.json({ error: "bad request" }, { status: 400 });

  if (!verifySignature(body)) {
    await db.insert(paymentEvents).values({ orderId: body.order_id, source: "notification", signatureValid: false,
      applied: false, transactionStatus: body.transaction_status ?? null, payload: body });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const confirmed = await getStatus(body.order_id);
  const result = await applyStatus(confirmed ?? body, "notification", true);
  return NextResponse.json(result);
}
