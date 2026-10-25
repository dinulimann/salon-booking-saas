// A stand-in for Midtrans used by the end-to-end tests and CI, where the
// sandbox is not reachable without secrets. It implements the three calls the
// app makes, with the same shapes and the same SHA-512 signature:
//   POST /snap/v1/transactions      -> { token, redirect_url }
//   GET  /pay/:token                -> a payment page (Pay / Let it expire)
//   GET  /v2/:order_id/status       -> transaction status
// Paying sends a signed HTTP notification to the app, like Midtrans does,
// then redirects the customer to the finish URL.
//
//   MIDTRANS_SERVER_KEY=... APP_URL=http://localhost:3000 node tools/fake-midtrans.mjs
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.FAKE_MIDTRANS_PORT ?? 4010);
const KEY = process.env.MIDTRANS_SERVER_KEY;
const APP = process.env.APP_URL ?? "http://localhost:3000";
const orders = new Map(); // order_id -> { amount, status, finish, token, payment_type }
const tokens = new Map(); // token -> order_id

const sign = (o, code, gross) => createHash("sha512").update(o + code + gross + KEY).digest("hex");
const codeOf = (s) => (s === "settlement" ? "200" : s === "pending" ? "201" : "407");

function status(orderId) {
  const o = orders.get(orderId);
  if (!o) return { status_code: "404", status_message: "Transaction doesn't exist." };
  const gross = `${o.amount}.00`;
  const code = codeOf(o.status);
  return { order_id: orderId, status_code: code, gross_amount: gross, transaction_status: o.status,
           payment_type: o.payment_type, fraud_status: "accept", signature_key: sign(orderId, code, gross),
           transaction_id: o.token };
}

const authorised = (req) => req.headers.authorization === "Basic " + Buffer.from(KEY + ":").toString("base64");
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};
const read = (req) => new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)); });

async function finishWith(orderId, newStatus) {
  const o = orders.get(orderId);
  o.status = newStatus;
  o.payment_type = newStatus === "settlement" ? "qris" : o.payment_type;
  const res = await fetch(`${APP}/api/midtrans/notification`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(status(orderId)),
  });
  console.log(`notified ${orderId} ${newStatus}: ${res.status}`);
  return o.finish ? `${o.finish}?order_id=${encodeURIComponent(orderId)}&transaction_status=${newStatus}` : APP;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === "POST" && url.pathname === "/snap/v1/transactions") {
      if (!authorised(req)) return send(res, 401, { error_messages: ["Access denied due to unauthorized transaction"] });
      const body = JSON.parse(await read(req));
      const { order_id, gross_amount } = body.transaction_details;
      const items = (body.item_details ?? []).reduce((s, i) => s + i.price * i.quantity, 0);
      if (items !== gross_amount) return send(res, 400, { error_messages: ["transaction_details.gross_amount is not equal to the sum of item_details"] });
      if (orders.has(order_id)) return send(res, 400, { error_messages: ["transaction_details.order_id sudah digunakan"] });
      const token = randomUUID();
      orders.set(order_id, { amount: gross_amount, status: "pending", finish: body.callbacks?.finish, token, payment_type: null });
      tokens.set(token, order_id);
      return send(res, 201, { token, redirect_url: `http://localhost:${PORT}/pay/${token}` });
    }
    const pay = url.pathname.match(/^\/pay\/([\w-]+)(\/(settle|expire))?$/);
    if (pay) {
      const orderId = tokens.get(pay[1]);
      if (!orderId) return send(res, 404, "unknown token", "text/plain");
      if (req.method === "POST" && pay[3]) {
        const next = await finishWith(orderId, pay[3] === "settle" ? "settlement" : "expire");
        res.writeHead(303, { Location: next });
        return res.end();
      }
      const o = orders.get(orderId);
      return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Fake Midtrans</title>
        <body style="font-family:system-ui;max-width:420px;margin:60px auto">
        <p style="color:#888">Fake Midtrans (tests only)</p>
        <h1>Rp${new Intl.NumberFormat("id-ID").format(o.amount)}</h1><p>Order ${orderId}</p>
        <form method="post" action="/pay/${pay[1]}/settle"><button style="padding:10px 20px">Bayar</button></form><br>
        <form method="post" action="/pay/${pay[1]}/expire"><button style="padding:10px 20px">Biarkan kedaluwarsa</button></form>`,
        "text/html");
    }
    const st = url.pathname.match(/^\/v2\/(.+)\/status$/);
    if (req.method === "GET" && st) {
      if (!authorised(req)) return send(res, 401, { status_code: "401" });
      return send(res, 200, status(decodeURIComponent(st[1])));
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: String(e) });
  }
}).listen(PORT, () => console.log(`fake Midtrans on :${PORT} -> notifications to ${APP}`));
