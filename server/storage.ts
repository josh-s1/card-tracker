import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

/**
 * Two storage modes, chosen by env vars:
 *  - Local:  no TURSO_DATABASE_URL set → SQLite file "data.db" (dev / sandbox).
 *  - Hosted: TURSO_DATABASE_URL (libsql://...) + TURSO_AUTH_TOKEN → Turso cloud DB
 *            (free tier, keeps data across restarts on free hosting like Render).
 */
const url = process.env.TURSO_DATABASE_URL ?? "file:data.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

const client = createClient({
  url,
  ...(authToken ? { authToken } : {}),
});

export const db = drizzle(client);

/**
 * Creates tables on first boot. Raw SQL so a fresh cloud database needs no
 * migration step — the app is usable the moment it is deployed.
 */
const DDL = [
  `CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    institution_id TEXT NOT NULL DEFAULT '',
    institution_name TEXT NOT NULL,
    access_token TEXT NOT NULL DEFAULT '',
    cursor TEXT,
    is_demo INTEGER NOT NULL DEFAULT 0,
    last_synced_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    name TEXT NOT NULL,
    official_name TEXT,
    mask TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'credit',
    subtype TEXT NOT NULL DEFAULT 'credit card',
    network TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#1F3A5F',
    currency TEXT NOT NULL DEFAULT 'USD',
    balance_cents INTEGER NOT NULL DEFAULT 0,
    limit_cents INTEGER,
    apr TEXT,
    due_date TEXT,
    min_due_cents INTEGER,
    statement_balance_cents INTEGER,
    statement_close_date TEXT,
    last_payment_cents INTEGER,
    last_payment_date TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    merchant_name TEXT,
    amount_cents INTEGER NOT NULL,
    category TEXT NOT NULL DEFAULT 'Other',
    pending INTEGER NOT NULL DEFAULT 0
  )`,
];

export async function ensureSchema(): Promise<void> {
  for (const stmt of DDL) {
    await client.execute(stmt);
  }
}
