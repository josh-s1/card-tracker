import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import type * as z from "zod/mini";

/**
 * A Plaid "Item" = one bank login (may contain several cards).
 * Demo data uses id = "demo".
 */
export const items = sqliteTable("items", {
  id: text("id").primaryKey(), // Plaid item_id, or "demo"
  institutionId: text("institution_id").notNull().default(""),
  institutionName: text("institution_name").notNull(),
  accessToken: text("access_token").notNull().default(""), // never sent to client
  cursor: text("cursor"), // transactions/sync cursor
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull(),
});

/**
 * One card/account. Credit-card facts (APR, due date...) come from
 * Plaid Liabilities and are nullable because non-credit accounts lack them.
 * Money is stored in integer cents.
 */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(), // Plaid account_id, or demo id
  itemId: text("item_id").notNull(),
  name: text("name").notNull(),
  officialName: text("official_name"),
  mask: text("mask").notNull().default(""),
  type: text("type").notNull().default("credit"), // depository | credit | ...
  subtype: text("subtype").notNull().default("credit card"),
  network: text("network").notNull().default(""), // Visa / Mastercard / Amex...
  color: text("color").notNull().default("#1F3A5F"),
  currency: text("currency").notNull().default("USD"),
  balanceCents: integer("balance_cents").notNull().default(0), // amount currently owed
  limitCents: integer("limit_cents"), // credit limit, null when N/A
  // Credit-card statement facts (from Liabilities; null for non-credit)
  apr: text("apr"), // e.g. "21.99"
  dueDate: text("due_date"), // yyyy-mm-dd
  minDueCents: integer("min_due_cents"),
  statementBalanceCents: integer("statement_balance_cents"),
  statementCloseDate: text("statement_close_date"),
  lastPaymentCents: integer("last_payment_cents"),
  lastPaymentDate: text("last_payment_date"),
});

/** One transaction. amountCents > 0 = charge, < 0 = payment/credit. */
export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(), // Plaid transaction_id, or demo id
  accountId: text("account_id").notNull(),
  itemId: text("item_id").notNull(),
  date: text("date").notNull(), // yyyy-mm-dd
  name: text("name").notNull(), // raw description
  merchantName: text("merchant_name"),
  amountCents: integer("amount_cents").notNull(),
  category: text("category").notNull().default("Other"),
  pending: integer("pending", { mode: "boolean" }).notNull().default(false),
});

export const insertItemSchema = createInsertSchema(items);
export const insertAccountSchema = createInsertSchema(accounts);
export const insertTransactionSchema = createInsertSchema(transactions);

export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof items.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

/** Shared client-facing types (access tokens stripped). */
export type SafeItem = Omit<Item, "accessToken" | "cursor"> & { disconnectPending?: boolean };
