import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import type * as z from "zod/mini";
import type { IssuerRewardCheck, RewardRules, StoredRewardRules } from "./rewards";

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

/** User-owned labels, separate from provider-owned account fields. */
export const accountPreferences = sqliteTable("account_preferences", {
  accountId: text("account_id").primaryKey(),
  nickname: text("nickname").notNull(),
});

export const rewardProfiles = sqliteTable("reward_profiles", {
  accountId: text("account_id").primaryKey(),
  productId: text("product_id"),
  rules: text("rules", { mode: "json" }).$type<StoredRewardRules>().notNull(),
});

export const issuerRewardChecks = sqliteTable("issuer_reward_checks", {
  sourceId: text("source_id").primaryKey(),
  payload: text("payload", { mode: "json" }).$type<IssuerRewardCheck>().notNull(),
});

export const syncIssues = sqliteTable("sync_issues", {
  itemId: text("item_id").primaryKey(),
  status: text("status", { enum: ["failed", "reconnect"] }).notNull(),
});

export const transactionRewardContext = sqliteTable("transaction_reward_context", {
  transactionId: text("transaction_id").primaryKey(),
  itemId: text("item_id").notNull(),
  currency: text("currency"),
  detailedCategory: text("detailed_category"),
});

export const insertItemSchema = createInsertSchema(items);
export const insertAccountSchema = createInsertSchema(accounts);
export const insertTransactionSchema = createInsertSchema(transactions);

export type InsertItem = z.infer<typeof insertItemSchema>;
export type Item = typeof items.$inferSelect;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accounts.$inferSelect & {
  nickname?: string | null; rewardRules?: RewardRules; rewardProductId?: string | null; rewardRatesCheckedAt?: string;
};
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect & {
  rewardContext?: Pick<typeof transactionRewardContext.$inferSelect, "currency" | "detailedCategory">;
};

/** Shared client-facing types (access tokens stripped). */
export type SafeItem = Omit<Item, "accessToken" | "cursor"> & { disconnectPending?: boolean; syncIssue?: "failed" | "reconnect" };
