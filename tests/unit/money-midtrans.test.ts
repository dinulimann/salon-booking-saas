import { describe, expect, it } from "vitest";
import { canTransition, signature, toPaymentState, verifySignature } from "@/lib/midtrans";
import { invoiceAmounts, invoiceNumber } from "@/lib/money";

describe("invoiceAmounts", () => {
  it("pays in full without tax by default", () => {
    expect(invoiceAmounts(150000, 0, 100)).toEqual({ subtotal: 150000, tax: 0, total: 150000, depositDue: 150000 });
  });
  it("adds 11% PPN rounded half up to whole rupiah", () => {
    expect(invoiceAmounts(45000, 1100, 100).tax).toBe(4950);
    expect(invoiceAmounts(12345, 1100, 100).tax).toBe(1358); // 1357.95
  });
  it("takes a 50% deposit of the total including tax", () => {
    const a = invoiceAmounts(75000, 1100, 50);
    expect(a.total).toBe(83250);
    expect(a.depositDue).toBe(41625);
  });
  it("rejects fractional rupiah", () => {
    expect(() => invoiceAmounts(1000.5, 0, 100)).toThrow();
  });
  it("numbers invoices per year with four digits", () => {
    expect(invoiceNumber(2026, 7)).toBe("INV/2026/0007");
  });
});

describe("Midtrans notifications", () => {
  const key = "SB-Mid-server-test";
  const n = { order_id: "BK-abc-1", status_code: "200", gross_amount: "150000.00" };

  it("accepts the documented signature and rejects any change", () => {
    const sig = signature(n.order_id, n.status_code, n.gross_amount, key);
    expect(verifySignature({ ...n, signature_key: sig }, key)).toBe(true);
    expect(verifySignature({ ...n, gross_amount: "1.00", signature_key: sig }, key)).toBe(false);
    expect(verifySignature({ ...n, signature_key: sig }, "another-key")).toBe(false);
    expect(verifySignature({ ...n, signature_key: undefined }, key)).toBe(false);
  });

  it("maps statuses, including card fraud challenges", () => {
    expect(toPaymentState("settlement")).toBe("paid");
    expect(toPaymentState("capture", "accept")).toBe("paid");
    expect(toPaymentState("capture", "challenge")).toBe("pending");
    expect(toPaymentState("expire")).toBe("expired");
    expect(toPaymentState("deny")).toBe("failed");
    expect(toPaymentState("authorize")).toBeNull();
  });

  it("only moves forward, so late or repeated notifications change nothing", () => {
    expect(canTransition("pending", "paid")).toBe(true);
    expect(canTransition("paid", "pending")).toBe(false);  // a late "pending"
    expect(canTransition("paid", "paid")).toBe(false);     // a retry
    expect(canTransition("expired", "paid")).toBe(false);
    expect(canTransition("paid", "refunded")).toBe(true);
  });
});
