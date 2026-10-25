import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// One pool per process (Next.js dev reloads modules; keep the pool on globalThis).
const g = globalThis as unknown as { pg?: postgres.Sql };
const client = g.pg ?? postgres(process.env.DATABASE_URL!, { max: 10, onnotice: () => {} });
if (process.env.NODE_ENV !== "production") g.pg = client;

/** Connected as salon_app: every tenant table is behind Row Level Security. */
export const db = drizzle(client, { schema });
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Runs `fn` in a transaction that can only see and write rows of `tenantId`. */
export async function withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
