import { expect, test, type Page } from "@playwright/test";

const run = Date.now().toString(36);
let n = 0;
// a distinct number per booking: the customer record is keyed by phone
const phone = () => `0812${String(Date.now() % 1e6).padStart(6, "0")}${n++}`;

async function bookFirstSlot(page: Page, service: string, customer: string) {
  await page.goto("/s/kumis");
  await page.getByRole("listitem").filter({ has: page.getByText(service, { exact: true }) }).getByRole("link", { name: "Pilih" }).click();
  // first day (of the next 14) that has a free slot
  const days = page.getByRole("navigation", { name: "Tanggal" }).getByRole("link");
  for (let i = 0; i < 14; i++) {
    await days.nth(i).click();
    if (await page.getByTestId("slots").count()) break;
  }
  const slot = page.getByTestId("slots").getByRole("link").first();
  const time = await slot.textContent();
  await slot.click();
  await page.getByLabel("Nama").fill(customer);
  await page.getByLabel("Nomor HP (WhatsApp)").fill(phone());
  await page.getByRole("button", { name: "Lanjut ke pembayaran" }).click();
  await expect(page.getByText("Fake Midtrans (tests only)")).toBeVisible();
  return time!;
}

test("a customer books, pays with Midtrans and gets a confirmed booking with an invoice", async ({ page }) => {
  await bookFirstSlot(page, "Cukur jenggot", `Pelanggan ${run}`);
  await page.getByRole("button", { name: "Bayar" }).click();
  await expect(page.getByText("Terkonfirmasi")).toBeVisible();
  await expect(page.getByText(/^INV\/\d{4}\/\d{4}$/)).toBeVisible();
  await expect(page.getByText("Pembayaran diterima")).toBeVisible();
});

test("a payment left to expire cancels the booking and frees the slot", async ({ page }) => {
  const time = await bookFirstSlot(page, "Hair spa", `Batal ${run}`);
  await page.getByRole("button", { name: "Biarkan kedaluwarsa" }).click();
  await expect(page.getByText("Dibatalkan")).toBeVisible();
  await page.getByRole("link", { name: "Booking ulang" }).click();
  // the same time is offered again on that day
  const days = page.getByRole("navigation", { name: "Tanggal" }).getByRole("link");
  for (let i = 0; i < 14; i++) {
    await days.nth(i).click();
    if (await page.getByTestId("slots").count()) break;
  }
  await expect(page.getByTestId("slots").getByRole("link", { name: time, exact: true })).toBeVisible();
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("demo12345");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("the owner sees the paid invoice; another salon's owner cannot open it", async ({ page, browser }) => {
  const name = `Pemilik lihat ${run}`;
  await bookFirstSlot(page, "Potong rambut", name);
  await page.getByRole("button", { name: "Bayar" }).click();
  await expect(page.getByText("Terkonfirmasi")).toBeVisible();

  await login(page, "owner@kumis.test");
  await page.goto("/dashboard/invoices");
  await page.getByRole("row").filter({ hasText: name }).getByRole("link").click();
  await expect(page).toHaveURL(/\/dashboard\/invoices\/[0-9a-f-]{36}$/);
  // Next keeps the previous page mounted but hidden (back navigation), so match visible elements only
  await expect(page.getByText(name).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("Lunas").filter({ visible: true }).first()).toBeVisible();
  const invoiceUrl = page.url();

  const other = await browser.newPage();
  await login(other, "owner@melati.test");
  await other.goto(invoiceUrl);
  // The page streams (Partial Prerender), so the status is already 200 when the
  // lookup runs; Next renders the not-found page with robots noindex instead.
  // What matters is that none of the other salon's data reaches the browser.
  await expect(other.getByText("This page could not be found.")).toBeVisible();
  const html = await other.content();
  expect(html).not.toContain(name);
  expect(html).not.toContain("Kemang");
});

test("the dashboard needs a session", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("a notification with a forged signature is rejected", async ({ request }) => {
  const res = await request.post("/api/midtrans/notification", { data: {
    order_id: "BK-forged-1", status_code: "200", gross_amount: "75000.00", transaction_status: "settlement", signature_key: "0".repeat(128),
  } });
  expect(res.status()).toBe(401);
});
