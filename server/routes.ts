import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db } from "./storage";
import { items, accounts, transactions } from "@shared/schema";
import { seedDemoData, seedIfEmpty } from "./seed";
import {
  plaidConfigured,
  plaidEnv,
  createLinkToken,
  exchangePublicToken,
  getItem,
  getInstitutionById,
  getAccountsBalances,
  getLiabilities,
  transactionsSync,
  removeItem,
  mapCategory,
  PlaidError,
} from "./plaid";

const CARD_COLORS = ["#1F3A5F", "#1E4D3F", "#4A2C4F", "#8A4A2F", "#2F5D75", "#5C3A6E", "#6E4A2F"];

function cents(v: number | null | undefined): number | null {
  if (v == null || Number.isNaN(v)) return null;
  return Math.round(v * 100);
}

function detectNetwork(name: string | null | undefined, official: string | null | undefined): string {
  const s = `${official ?? ""} ${name ?? ""}`.toLowerCase();
  if (s.includes("amex") || s.includes("american express")) return "Amex";
  if (s.includes("mastercard")) return "Mastercard";
  if (s.includes("discover")) return "Discover";
  if (s.includes("visa")) return "Visa";
  return "";
}

/** Full sync for one Plaid item: balances, liabilities, transactions. */
async function syncItem(itemId: string): Promise<void> {
  const itemRows = await db.select().from(items).where(eq(items.id, itemId));
  const item = itemRows[0];
  if (!item || item.isDemo) return;
  const token = item.accessToken;

  // 1) Accounts + balances
  const accountsRes = await getAccountsBalances(token);
  const existingAccounts = await db.select().from(accounts);
  let colorIdx = existingAccounts.length;
  for (const acc of accountsRes.accounts ?? []) {
    const existing = (
      await db.select().from(accounts).where(eq(accounts.id, acc.account_id))
    )[0];
    const color =
      existing?.color ?? CARD_COLORS[colorIdx++ % CARD_COLORS.length];
    const balances = acc.balances ?? {};
    const values = {
      id: acc.account_id,
      itemId: item.id,
      name: acc.name ?? "Unnamed account",
      officialName: acc.official_name ?? null,
      mask: acc.mask ?? "",
      type: acc.type ?? "credit",
      subtype: acc.subtype ?? "",
      network: detectNetwork(acc.name, acc.official_name),
      color,
      currency: balances.iso_currency_code ?? "USD",
      balanceCents: cents(balances.current) ?? 0,
      limitCents: cents(balances.limit),
      apr: null as string | null,
      dueDate: null as string | null,
      minDueCents: null as number | null,
      statementBalanceCents: null as number | null,
      statementCloseDate: null as string | null,
      lastPaymentCents: null as number | null,
      lastPaymentDate: null as string | null,
    };
    // Preserve existing credit facts until Liabilities overwrites below
    if (existing) {
      await db.update(accounts).set(values).where(eq(accounts.id, acc.account_id));
    } else {
      await db.insert(accounts).values(values);
    }
  }

  // 2) Credit-card liabilities (APR, due date, minimum, statement)
  try {
    const liab = await getLiabilities(token);
    const credit = liab.liabilities?.credit ?? [];
    for (const c of credit) {
      const p = c.account_id;
      const patch: Record<string, unknown> = {};
      if (c.aprs?.length) {
        const aprVal = c.aprs.find((a: any) => a.apr_percentage != null)?.apr_percentage;
        if (aprVal != null) patch.apr = String(aprVal);
      }
      if (c.minimum_payment_amount != null) patch.minDueCents = cents(c.minimum_payment_amount);
      if (c.next_payment_due_date) patch.dueDate = c.next_payment_due_date.slice(0, 10);
      if (c.last_statement_balance != null)
        patch.statementBalanceCents = cents(c.last_statement_balance);
      if (c.statement_close_date) patch.statementCloseDate = c.statement_close_date.slice(0, 10);
      if (c.last_payment_amount != null) patch.lastPaymentCents = cents(c.last_payment_amount);
      if (c.last_payment_date) patch.lastPaymentDate = c.last_payment_date.slice(0, 10);
      if (Object.keys(patch).length) {
        await db.update(accounts).set(patch).where(eq(accounts.id, p));
      }
    }
  } catch (err) {
    console.error("Liabilities fetch failed:", err);
  }

  // 3) Transactions (sync with cursor)
  let cursor: string | null = item.cursor ?? null;
  let hasMore = true;
  while (hasMore) {
    const res: any = await transactionsSync(token, cursor);
    for (const t of res.added ?? []) {
      const row = {
        id: t.transaction_id,
        accountId: t.account_id,
        itemId: item.id,
        date: (t.date ?? "").slice(0, 10),
        name: t.name ?? "Unknown",
        merchantName: t.merchant_name ?? t.name ?? null,
        amountCents: cents(t.amount) ?? 0,
        category: mapCategory(
          t.personal_finance_category?.primary,
          t.transaction_type,
        ),
        pending: Boolean(t.pending),
      };
      await db
        .insert(transactions)
        .values(row)
        .onConflictDoUpdate({ target: transactions.id, set: row });
    }
    for (const id of res.removed ?? []) {
      await db.delete(transactions).where(eq(transactions.id, id));
    }
    cursor = res.next_cursor ?? cursor;
    hasMore = Boolean(res.has_more);
  }
  await db.update(items)
    .set({ cursor, lastSyncedAt: new Date().toISOString() })
    .where(eq(items.id, item.id));
}

async function getState() {
  const allItems = await db.select().from(items);
  const allAccounts = await db.select().from(accounts);
  const allTxns = await db.select().from(transactions);
  return {
    items: allItems.map(({ accessToken, ...rest }) => rest),
    accounts: allAccounts,
    transactions: allTxns,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  await seedIfEmpty();

  // --- PIN lock (only when APP_PIN is set on the server) ---
  app.use("/api", (req: any, res: any, next: any) => {
    const pin = process.env.APP_PIN;
    if (!pin) return next();
    if (req.path === "/config") return next();
    if (req.get("x-app-pin") === pin) return next();
    return res.status(401).json({ message: "locked" });
  });

  const wrap =
    (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response) =>
      Promise.resolve(fn(req, res)).catch((err: any) => {
        if (err instanceof PlaidError) {
          return res.status(err.status).json({ message: err.message, code: err.plaidCode });
        }
        console.error(err);
        res.status(500).json({ message: err.message || "Server error" });
      });

  app.get("/api/config", (_req, res) => {
    res.json({
      plaidConfigured: plaidConfigured(),
      plaidEnv: plaidEnv(),
      pinRequired: Boolean(process.env.APP_PIN),
    });
  });

  app.get("/api/state", async (_req, res) => {
    res.json(await getState());
  });

  // --- Plaid ---
  app.post(
    "/api/plaid/link-token",
    wrap(async (_req, res) => {
      if (!plaidConfigured()) {
        return res.status(400).json({
          message:
            "Plaid keys are not configured on this server yet. Add PLAID_CLIENT_ID and PLAID_SECRET.",
        });
      }
      const r = await createLinkToken("josh");
      res.json({ link_token: r.link_token });
    }),
  );

  app.post(
    "/api/plaid/exchange",
    wrap(async (req, res) => {
      const { public_token } = req.body ?? {};
      if (!public_token) return res.status(400).json({ message: "public_token required" });
      const ex = await exchangePublicToken(public_token);
      const itemRes = await getItem(ex.access_token);
      const institutionId = itemRes.item?.institution_id ?? "";
      let institutionName = "Your bank";
      try {
        const inst = await getInstitutionById(institutionId);
        institutionName = inst.institution?.name ?? institutionName;
      } catch { /* non-fatal */ }
      const now = new Date().toISOString();
      await db.insert(items)
        .values({
          id: ex.item_id,
          institutionId,
          institutionName,
          accessToken: ex.access_token,
          cursor: null,
          isDemo: false,
          createdAt: now,
        })
        .onConflictDoNothing();
      await syncItem(ex.item_id);
      res.json(await getState());
    }),
  );

  app.post(
    "/api/plaid/sync",
    wrap(async (_req, res) => {
      const allItems = await db.select().from(items);
      const errors: string[] = [];
      for (const item of allItems) {
        if (item.isDemo) continue;
        try {
          await syncItem(item.id);
        } catch (err: any) {
          errors.push(`${item.institutionName}: ${err.message}`);
        }
      }
      res.json({ ...(await getState()), errors });
    }),
  );

  app.post(
    "/api/plaid/remove",
    wrap(async (req, res) => {
      const { itemId } = req.body ?? {};
      const item = (await db.select().from(items).where(eq(items.id, itemId)))[0];
      if (!item) return res.status(404).json({ message: "Item not found" });
      if (!item.isDemo && item.accessToken) {
        try {
          await removeItem(item.accessToken);
        } catch { /* non-fatal */ }
      }
      await db.delete(transactions).where(eq(transactions.itemId, itemId));
      await db.delete(accounts).where(eq(accounts.itemId, itemId));
      await db.delete(items).where(eq(items.id, itemId));
      res.json(await getState());
    }),
  );

  // --- Demo data ---
  app.post(
    "/api/demo/seed",
    wrap(async (_req, res) => {
      await seedDemoData();
      res.json(await getState());
    }),
  );

  app.post(
    "/api/demo/clear",
    wrap(async (_req, res) => {
      // Remove only real (non-demo) data
      const allItems = await db.select().from(items);
      const realItems = allItems.filter((i) => !i.isDemo);
      for (const item of realItems) {
        await db.delete(transactions).where(eq(transactions.itemId, item.id));
        await db.delete(accounts).where(eq(transactions.itemId, item.id));
        await db.delete(items).where(eq(items.id, item.id));
      }
      res.json(await getState());
    }),
  );

  return httpServer;
}
