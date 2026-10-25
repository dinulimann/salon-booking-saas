import { sql } from "drizzle-orm";
import {
  boolean, check, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// better-auth (core tables). Not tenant-scoped: one person can belong to
// several salons through `memberships`.
// ---------------------------------------------------------------------------
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Tenants. Readable without a tenant context (the public booking page looks a
// salon up by slug); everything below is protected by Row Level Security
// (drizzle/0001_rls.sql).
// ---------------------------------------------------------------------------
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  address: text("address"),
  phone: text("phone"),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  taxRateBp: integer("tax_rate_bp").notNull().default(0),          // PPN in basis points: 1100 = 11%
  depositPercent: integer("deposit_percent").notNull().default(100), // share paid online when booking
  holdMinutes: integer("hold_minutes").notNull().default(15),        // unpaid bookings release the slot after this
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("tenants_slug_format", sql`${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,40}$'`),
  check("tenants_deposit_range", sql`${t.depositPercent} between 10 and 100`),
]);

export const memberships = pgTable("memberships", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "staff"] }).notNull(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId] })]);

export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
}, (t) => [index("staff_tenant").on(t.tenantId)]);

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
  price: integer("price").notNull(), // rupiah
  active: boolean("active").notNull().default(true),
}, (t) => [
  index("services_tenant").on(t.tenantId),
  check("services_duration", sql`${t.durationMin} between 5 and 480 and ${t.durationMin} % 5 = 0`),
  check("services_price", sql`${t.price} >= 0`),
]);

export const staffServices = pgTable("staff_services", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.staffId, t.serviceId] })]);

// Weekly schedule in the salon's local time, minutes after midnight.
export const workingHours = pgTable("working_hours", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
  weekday: smallint("weekday").notNull(), // 0 = Sunday
  startMin: smallint("start_min").notNull(),
  endMin: smallint("end_min").notNull(),
}, (t) => [
  primaryKey({ columns: [t.staffId, t.weekday, t.startMin] }),
  check("working_hours_range", sql`${t.weekday} between 0 and 6 and ${t.startMin} >= 0 and ${t.endMin} <= 1440 and ${t.startMin} < ${t.endMin}`),
]);

export const customers = pgTable("customers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone").notNull(), // normalised 62xxxxxxxxx
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("customers_tenant_phone").on(t.tenantId, t.phone)]);

// No two active bookings of one staff member may overlap: enforced by an
// exclusion constraint on (staff_id, tstzrange(starts_at, ends_at)) in
// drizzle/0001_rls.sql, so it holds even for concurrent requests.
export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull().references(() => staff.id),
  serviceId: uuid("service_id").notNull().references(() => services.id),
  customerId: uuid("customer_id").notNull().references(() => customers.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: text("status", { enum: ["pending_payment", "confirmed", "cancelled", "completed", "no_show"] }).notNull(),
  holdUntil: timestamp("hold_until", { withTimezone: true }), // set while pending_payment
  price: integer("price").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("bookings_tenant_start").on(t.tenantId, t.startsAt),
  check("bookings_time", sql`${t.startsAt} < ${t.endsAt}`),
]);

export const invoiceCounters = pgTable("invoice_counters", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  year: smallint("year").notNull(),
  lastNo: integer("last_no").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.year] })]);

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").notNull().references(() => bookings.id).unique(),
  // "Bill to" as it was when the invoice was made; the customer record may change later
  billName: text("bill_name").notNull(),
  billPhone: text("bill_phone").notNull(),
  billEmail: text("bill_email"),
  // INV/2026/0001, assigned when the first payment succeeds, so numbers are
  // gapless among real invoices and abandoned bookings never consume one.
  number: text("number"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  subtotal: integer("subtotal").notNull(),
  tax: integer("tax").notNull(),
  total: integer("total").notNull(),
  depositDue: integer("deposit_due").notNull(), // paid online at booking
  amountPaid: integer("amount_paid").notNull().default(0),
  status: text("status", { enum: ["unpaid", "deposit_paid", "paid", "void"] }).notNull().default("unpaid"),
}, (t) => [
  uniqueIndex("invoices_tenant_number").on(t.tenantId, t.number),
  check("invoices_amounts", sql`${t.total} = ${t.subtotal} + ${t.tax} and ${t.depositDue} between 0 and ${t.total} and ${t.amountPaid} between 0 and ${t.total}`),
]);

// One row per Midtrans order. `order_id` is what Midtrans knows us by.
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  orderId: text("order_id").notNull().unique(),
  amount: integer("amount").notNull(),
  status: text("status", { enum: ["pending", "paid", "failed", "expired", "refunded"] }).notNull().default("pending"),
  snapToken: text("snap_token"),
  redirectUrl: text("redirect_url"),
  paymentType: text("payment_type"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Every notification Midtrans sends, verified or not. Append-only audit trail.
export const paymentEvents = pgTable("payment_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  orderId: text("order_id").notNull(),
  source: text("source", { enum: ["notification", "status_check"] }).notNull(),
  transactionStatus: text("transaction_status"),
  signatureValid: boolean("signature_valid"),
  applied: boolean("applied").notNull(), // did it change the payment's state?
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("payment_events_order").on(t.orderId)]);
