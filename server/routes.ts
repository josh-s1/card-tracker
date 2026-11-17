import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";
import { db } from "./storage";
import { items, accounts, transactions, accountPreferences } from "@shared/schema";
import { seedDemoData, seedIfEmpty } from "./seed";
import { createPinGuard } from "./auth";
import { disconnectItem, DisconnectError } from "./data-lifecycle";
import { encryptAccessToken, decryptAccessToken } from "./token-vault";
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
  if (v == null || !Number.isFinite(v)) return null;
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
export async function syncItem(itemId: string): Promise<void> {
  const itemRows = await db.select().from(items).where(eq(items.id, itemId));
  const item = itemRows[0];
  if (!item || item.isDemo || item.accessToken.startsWith("revoked:")) return;
  const token = decryptAccessToken(item.accessToken);

  // Fetch a complete snapshot before changing any visible financial data.
  const accountsRes = await getAccountsBalances(token);
  if (!Array.isArray(accountsRes.accounts)) throw new Error("Invalid account snapshot");
  const liab = await getLiabilities(token); // Failure retains the previous complete snapshot.
  if (!liab.liabilities || typeof liab.liabilities !== "object") throw new Error("Invalid liability snapshot");
  let pages: any[] = [];
  let cursor = item.cursor;
  for (let attempt = 0; attempt < 3; attempt++) {
    pages = [];
    cursor = item.cursor;
    try {
      for (let page = 0; ; page++) {
        if (page >= 100) throw new Error("Transaction pagination limit exceeded");
        const result = await transactionsSync(token, cursor);
        if (!Array.isArray(result.added) || !Array.isArray(result.modified) ||
            !Array.isArray(result.removed) || typeof result.next_cursor !== "string" ||
            typeof result.has_more !== "boolean") throw new Error("Invalid transaction snapshot");
        pages.push(result);
        if (result.has_more && result.next_cursor === cursor) throw new Error("Transaction cursor did not advance");
        cursor = result.next_cursor;
        if (!result.has_more) break;
      }
      break;
    } catch (error) {
      if (error instanceof PlaidError &&
          error.plaidCode === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < 2) continue;
      throw error;
    }
  }

  await db.transaction(async (tx) => {
    const current = (await tx.select().from(items).where(eq(items.id, item.id)))[0];
    // A disconnect or competing sync must not resurrect/overwrite rows.
    if (!current || current.accessToken !== item.accessToken ||
        current.cursor !== item.cursor || current.lastSyncedAt !== item.lastSyncedAt) return;
    const existingAccounts = await tx.select().from(accounts);
    const snapshotIds = new Set(accountsRes.accounts.map((a: any) => a.account_id));
    if (existingAccounts.some(a => a.itemId === item.id && !snapshotIds.has(a.id))) {
      // Do not certify stale figures as refreshed, or silently discard history
      // when account-sharing permissions change. Require connection review.
      throw new Error("Account access changed; review the bank connection.");
    }
    let colorIdx = existingAccounts.length;
    const credit = liab.liabilities?.credit ?? [];
    for (const acc of accountsRes.accounts) {
      if (typeof acc.account_id !== "string") throw new Error("Invalid account ID");
      if (!Number.isFinite(acc.balances?.current)) throw new Error("Current account balance is unavailable");
      const existing = existingAccounts.find(a => a.id === acc.account_id);
      if (existing && existing.itemId !== item.id) throw new Error("Account scope mismatch");
      const c = credit.find((c: any) => c.account_id === acc.account_id);
      const values = {
        id: acc.account_id, itemId: item.id, name: acc.name ?? "Unnamed account",
        officialName: acc.official_name ?? null, mask: acc.mask ?? "",
        type: acc.type ?? "credit", subtype: acc.subtype ?? "",
        network: detectNetwork(acc.name, acc.official_name),
        color: existing?.color ?? CARD_COLORS[colorIdx++ % CARD_COLORS.length],
        currency: acc.balances?.iso_currency_code ?? "USD",
        balanceCents: cents(acc.balances.current)!,
        limitCents: cents(acc.balances?.limit),
        apr: c?.aprs?.find((a: any) => a.apr_percentage != null)?.apr_percentage?.toString() ?? null,
        dueDate: c?.next_payment_due_date?.slice(0, 10) ?? null,
        minDueCents: cents(c?.minimum_payment_amount),
        statementBalanceCents: cents(c?.last_statement_balance),
        statementCloseDate: c?.statement_close_date?.slice(0, 10) ?? null,
        lastPaymentCents: cents(c?.last_payment_amount),
        lastPaymentDate: c?.last_payment_date?.slice(0, 10) ?? null,
      };
      await tx.insert(accounts).values(values).onConflictDoUpdate({ target: accounts.id, set: values });
    }
    for (const res of pages) {
      for (const t of [...res.added, ...res.modified]) {
        if (typeof t.transaction_id !== "string" || typeof t.account_id !== "string" ||
            !Number.isFinite(t.amount)) throw new Error("Invalid transaction");
        const account = (await tx.select().from(accounts).where(eq(accounts.id, t.account_id)))[0];
        if (!account || account.itemId !== item.id) throw new Error("Transaction account mismatch");
        const existing = (await tx.select().from(transactions).where(eq(transactions.id, t.transaction_id)))[0];
        if (existing && existing.itemId !== item.id) throw new Error("Transaction scope mismatch");
        if (!t.pending && typeof t.pending_transaction_id === "string") {
          await tx.delete(transactions).where(and(eq(transactions.id, t.pending_transaction_id), eq(transactions.itemId, item.id)));
        }
        const row = {
        id: t.transaction_id, accountId: t.account_id,
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
      await tx
        .insert(transactions)
        .values(row)
        .onConflictDoUpdate({ target: transactions.id, set: row });
      }
      for (const removed of res.removed) {
        if (typeof removed.transaction_id !== "string") throw new Error("Invalid removed transaction");
        await tx.delete(transactions).where(and(eq(transactions.id, removed.transaction_id), eq(transactions.itemId, item.id)));
      }
    }
    const nextTime = Math.max(Date.now(), (Date.parse(item.lastSyncedAt ?? "") || 0) + 1);
    await tx.update(items)
    .set({ cursor, lastSyncedAt: new Date(nextTime).toISOString() })
    .where(eq(items.id, item.id));
  });
}

async function getState(showSamples = false) {
  const allItems = await db.select().from(items);
  const allAccounts = await db.select().from(accounts);
  const allTxns = await db.select().from(transactions);
  const preferences = await db.select().from(accountPreferences);
  const nicknames = new Map(preferences.map(p => [p.accountId, p.nickname]));
  const hasReal = allItems.some(i => !i.isDemo);
  const visibleItems = allItems.filter(i => !i.isDemo || (showSamples && !hasReal));
  const visibleIds = new Set(visibleItems.map(i => i.id));
  return {
    sampleDataAvailable: allItems.some(i => i.isDemo),
    items: visibleItems
      .map(({ accessToken, cursor, ...rest }) => ({ ...rest, disconnectPending: accessToken.startsWith("revoked:") })),
    accounts: allAccounts.filter(a => visibleIds.has(a.itemId))
      .map(a => ({ ...a, nickname: nicknames.get(a.id) ?? null })),
    transactions: allTxns.filter(t => visibleIds.has(t.itemId)),
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  await seedIfEmpty();

  app.use("/api", createPinGuard(process.env.APP_PIN));

  const wrap =
    (fn: (req: Request, res: Response) => unknown) =>
    (req: Request, res: Response) =>
      Promise.resolve(fn(req, res)).catch((err: any) => {
        if (err instanceof DisconnectError) {
          return res.status(502).json({ message: err.message });
        }
        if (err instanceof PlaidError) {
          return res.status(err.status).json({ message: err.message, code: err.plaidCode });
        }
        console.error("API request failed");
        res.status(500).json({ message: "Server error" });
      });

  app.get("/api/config", (_req, res) => {
    res.json({
      plaidConfigured: plaidConfigured(),
      plaidEnv: plaidEnv(),
      pinRequired: Boolean(process.env.APP_PIN),
      demoEnabled: process.env.NODE_ENV !== "production",
      securityRelease: "2026-11-17-card-nicknames-3",
    });
  });

  app.post("/api/unlock", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/state", wrap(async (req, res) => {
    res.json(await getState(req.get("x-show-samples") === "true"));
  }));

  app.post("/api/accounts/nickname", wrap(async (req, res) => {
    const { accountId, nickname } = req.body ?? {};
    if (typeof accountId !== "string" || !accountId.trim() || accountId.length > 512 ||
        typeof nickname !== "string" || nickname.length > 80 ||
        /[\u0000-\u001f\u007f]/.test(nickname)) {
      return res.status(400).json({ message: "Provide an account ID and a nickname of up to 80 characters, without line breaks." });
    }
    const cleaned = nickname.trim();
    const found = await db.transaction(async tx => {
      const account = (await tx.select().from(accounts).where(eq(accounts.id, accountId)))[0];
      if (!account || !(await tx.select().from(items).where(eq(items.id, account.itemId)))[0]) return false;
      if (!cleaned) {
        await tx.delete(accountPreferences).where(eq(accountPreferences.accountId, accountId));
      } else {
        await tx.insert(accountPreferences).values({ accountId, nickname: cleaned })
          .onConflictDoUpdate({ target: accountPreferences.accountId, set: { nickname: cleaned } });
      }
      return true;
    });
    if (!found) return res.status(404).json({ message: "Card not found." });
    res.json(await getState(req.get("x-show-samples") === "true"));
  }));

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
      if (typeof public_token !== "string" || !public_token || public_token.length > 4096) {
        return res.status(400).json({ message: "A valid public_token is required." });
      }
      const ex = await exchangePublicToken(public_token);
      if (typeof ex.item_id !== "string" || typeof ex.access_token !== "string") {
        throw new PlaidError("The bank connection response was incomplete.", 502, "INVALID_RESPONSE");
      }
      // Save first: metadata and initial sync failures must not orphan the grant.
      try {
        const encrypted = encryptAccessToken(ex.access_token);
        await db.insert(items).values({
          id: ex.item_id, institutionId: "", institutionName: "Your bank",
          accessToken: encrypted, cursor: null, isDemo: false,
          createdAt: new Date().toISOString(),
        }).onConflictDoUpdate({ target: items.id, set: { accessToken: encrypted } });
      } catch {
        try {
          await removeItem(ex.access_token);
        } catch {
          throw new PlaidError("The connection could not be saved and revocation could not be confirmed. Revoke this app's access in your bank before retrying.", 502, "LINK_RECOVERY_REQUIRED");
        }
        throw new PlaidError("The connection could not be saved. Bank access was revoked; please retry.", 502, "LINK_NOT_SAVED");
      }
      try {
        const itemRes = await getItem(ex.access_token);
        const institutionId = itemRes.item?.institution_id ?? "";
        const inst = await getInstitutionById(institutionId);
        await db.update(items).set({
          institutionId, institutionName: inst.institution?.name ?? "Your bank",
        }).where(and(eq(items.id, ex.item_id), eq(items.isDemo, false)));
      } catch { /* Saved bank remains accessible if metadata is unavailable. */ }
      const warnings: string[] = [];
      try {
        await syncItem(ex.item_id);
      } catch {
        warnings.push("Bank connected, but the initial sync did not complete. Use Sync now to retry; payment data is not yet verified.");
      }
      res.json({ ...(await getState(req.get("x-show-samples") === "true")), warnings });
    }),
  );

  app.post(
    "/api/plaid/sync",
    wrap(async (req, res) => {
      const allItems = await db.select().from(items);
      const errors: string[] = [];
      for (const item of allItems) {
        if (item.isDemo) continue;
        try {
          await syncItem(item.id);
        } catch {
          errors.push(`${item.institutionName}: sync did not complete. The last complete snapshot was kept. Review the bank connection if this persists.`);
        }
      }
      res.json({ ...(await getState(req.get("x-show-samples") === "true")), errors });
    }),
  );

  app.post(
    "/api/plaid/remove",
    wrap(async (req, res) => {
      const { itemId } = req.body ?? {};
      if (typeof itemId !== "string" || !itemId.trim()) {
        return res.status(400).json({ message: "A valid itemId is required." });
      }
      const item = (await db.select().from(items).where(eq(items.id, itemId)))[0];
      if (!item) return res.status(404).json({ message: "Item not found" });
      await disconnectItem(db, item, removeItem);
      res.json(await getState(req.get("x-show-samples") === "true"));
    }),
  );

  // --- Demo data ---
  app.post(
    "/api/demo/seed",
    wrap(async (req, res) => {
      if (process.env.NODE_ENV === "production") {
        return res.status(403).json({ message: "Sample mutations are disabled in production." });
      }
      await seedDemoData();
      res.json(await getState(req.get("x-show-samples") === "true"));
    }),
  );

  app.post(
    "/api/demo/clear",
    wrap(async (req, res) => {
      // This is disconnection, not a silent local-only wipe.
      if (req.body?.confirm !== "disconnect-all") {
        return res.status(400).json({ message: "Explicit confirmation is required to disconnect all banks." });
      }
      const allItems = await db.select().from(items);
      const realItems = allItems.filter((i) => !i.isDemo);
      const failed: string[] = [];
      for (const item of realItems) {
        try {
          await disconnectItem(db, item, removeItem);
        } catch {
          failed.push(item.institutionName);
        }
      }
      if (failed.length) {
        return res.status(502).json({
          message: "Some banks could not be disconnected. Their local records were kept; others may already be disconnected. Refresh and retry the remaining banks.",
        });
      }
      res.json(await getState(req.get("x-show-samples") === "true"));
    }),
  );

  return httpServer;
}
