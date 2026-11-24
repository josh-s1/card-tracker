import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { db, ensureSchema } from "./storage";
import { items, accounts, transactions, accountPreferences, rewardProfiles, issuerRewardChecks, syncIssues, transactionRewardContext } from "../shared/schema";
import { betterTransactionAlternative, findRewardProduct, purchaseEligible, rewardGroups, rewardEstimate, searchRewardCatalog, transactionEstimate } from "../shared/rewards";
import { issuerRewardSources } from "./issuer-rewards";
import { disconnectItem, DisconnectError } from "./data-lifecycle";
import { seedDemoData, seedIfEmpty } from "./seed";
import { registerRoutes, syncItem } from "./routes";
import { api, apiJson, LockedError, setPin, getPin, getShowSamples, setShowSamples } from "../client/src/lib/api";
import { encryptAccessToken, decryptAccessToken, validateProductionConfig } from "./token-vault";
import { cardName } from "../client/src/lib/format";
import { TxnList } from "../client/src/pages/TxnList";
import { PinContext, Shell } from "../client/src/App";

// Run only with an explicitly disposable local database, never hosted storage.
assert.equal(process.env.TURSO_DATABASE_URL, "file:/scratch/dummy.db");
assert.equal(process.env.TURSO_AUTH_TOKEN, undefined);

async function fixture() {
  process.env.NODE_ENV = "test";
  process.env.TOKEN_ENCRYPTION_KEY = "dummy-test-encryption-key-not-for-production";
  await ensureSchema();
  await db.delete(accountPreferences);
  await db.delete(rewardProfiles);
  await db.delete(issuerRewardChecks);
  await db.delete(syncIssues);
  await db.delete(transactionRewardContext);
  await db.delete(transactions);
  await db.delete(accounts);
  await db.delete(items);
  for (const id of ["bank-a", "bank-b"]) {
    await db.insert(items).values({
      id, institutionName: id, accessToken: encryptAccessToken(`dummy-${id}`),
      isDemo: false, createdAt: "2026-01-01",
    });
    await db.insert(accounts).values({ id: `account-${id}`, itemId: id, name: id });
    await db.insert(transactions).values({
      id: `txn-${id}`, accountId: `account-${id}`, itemId: id,
      date: "2026-01-01", name: "Dummy purchase", amountCents: 123,
    });
  }
}

async function snapshot() {
  return {
    items: await db.select().from(items).orderBy(items.id),
    accounts: await db.select().from(accounts).orderBy(accounts.id),
    transactions: await db.select().from(transactions).orderBy(transactions.id),
  };
}

async function bank(id = "bank-a") {
  return (await db.select().from(items).where(eq(items.id, id)))[0];
}

function mockResponse(status = 200, body = "{}") {
  return {
    status, ok: status >= 200 && status < 300, statusText: String(status),
    headers: { get: () => null },
    json: async () => JSON.parse(body), text: async () => body,
  } as unknown as Response;
}

test("production startup never creates samples; sample reset rejects without changes", async () => {
  await fixture();
  const before = await snapshot();
  process.env.NODE_ENV = "production";
  await seedIfEmpty();
  await assert.rejects(seedDemoData(), /disabled in production/);
  assert.deepEqual(await snapshot(), before);
  await db.delete(transactions);
  await db.delete(accounts);
  await db.delete(items);
  await seedIfEmpty();
  assert.equal((await snapshot()).items.length, 0);
});

test("repeated development sample reload preserves every real row and token", async () => {
  await fixture();
  process.env.NODE_ENV = "test";
  const before = await snapshot();
  await seedDemoData();
  await seedDemoData();
  const after = await snapshot();
  assert.deepEqual(after.items.filter(i => !i.isDemo), before.items);
  assert.deepEqual(after.accounts.filter(a => a.itemId !== "demo"), before.accounts);
  assert.deepEqual(after.transactions.filter(t => t.itemId !== "demo"), before.transactions);
  assert.equal(after.items.filter(i => i.isDemo).length, 1);
  assert.equal(after.accounts.filter(a => a.itemId === "demo").length, 3);
});

test("failed revocation preserves all records and hides upstream error details", async () => {
  await fixture();
  const before = await snapshot();
  await assert.rejects(
    disconnectItem(db, await bank(), async () => { throw new Error("dummy-private-upstream-detail"); }),
    (error: unknown) => error instanceof DisconnectError && !error.message.includes("private"),
  );
  assert.deepEqual(await snapshot(), before);
});

test("missing real-bank token fails closed without deleting", async () => {
  await fixture();
  const before = await snapshot();
  await assert.rejects(
    disconnectItem(db, { ...(await bank()), accessToken: "" }, async () => assert.fail("must not call provider")),
    DisconnectError,
  );
  assert.deepEqual(await snapshot(), before);
});

test("successful disconnect revokes first, deletes only selected bank including accounts", async () => {
  await fixture();
  const selected = await bank();
  let calls = 0;
  await disconnectItem(db, selected, async token => {
    calls++;
    assert.equal(token, "dummy-bank-a");
    assert.equal((await snapshot()).transactions.length, 2);
  });
  assert.equal(calls, 1);
  const after = await snapshot();
  assert.deepEqual(after.items.map(i => i.id), ["bank-b"]);
  assert.deepEqual(after.accounts.map(a => a.itemId), ["bank-b"]);
  assert.deepEqual(after.transactions.map(t => t.itemId), ["bank-b"]);
});

test("local deletion failure rolls back all three tables", async () => {
  await fixture();
  const before = await snapshot();
  await db.run(sql`CREATE TRIGGER fail_dummy_delete BEFORE DELETE ON items
    WHEN OLD.id = 'bank-a' BEGIN SELECT RAISE(ABORT, 'dummy failure'); END`);
  try {
    await assert.rejects(disconnectItem(db, await bank(), async () => ({})));
    const after = await snapshot();
    assert.deepEqual(after.accounts, before.accounts);
    assert.deepEqual(after.transactions, before.transactions);
    assert.equal(after.items[0].accessToken, `revoked:${before.items[0].accessToken}`);
  } finally {
    await db.run(sql`DROP TRIGGER fail_dummy_delete`);
  }
  await disconnectItem(db, await bank(), async () => assert.fail("revocation must not be repeated"));
  assert.equal(await bank(), undefined);
});

const handlers = new Map<string, (...args: any[]) => any>();
async function routes() {
  process.env.NODE_ENV = "production";
  await registerRoutes({} as any, {
    use: () => {},
    get: (path: string, handler: any) => handlers.set(`GET ${path}`, handler),
    post: (path: string, handler: any) => handlers.set(`POST ${path}`, handler),
  } as any);
}
async function invoke(path: string, body?: unknown, method = "POST", headers: Record<string, string> = {}) {
  let status = 200;
  let payload: any;
  const response = {
    setHeader() {},
    status(code: number) { status = code; return response; },
    json(value: unknown) { payload = value; return response; },
  };
  await handlers.get(`${method} ${path}`)!({ body, get: (name: string) => headers[name.toLowerCase()] }, response);
  return { status, payload };
}

test("production sample route rejects and config hides its control", async () => {
  await fixture();
  await routes();
  const before = await snapshot();
  assert.equal((await invoke("/api/demo/seed")).status, 403);
  assert.equal((await invoke("/api/config", undefined, "GET")).payload.demoEnabled, false);
  assert.deepEqual(await snapshot(), before);
});

test("disconnect-all without explicit confirmation does not mutate", async () => {
  await fixture();
  await routes();
  const before = await snapshot();
  assert.equal((await invoke("/api/demo/clear")).status, 400);
  assert.deepEqual(await snapshot(), before);
});

test("disconnect route rejects invalid item selectors", async () => {
  await fixture();
  await routes();
  for (const itemId of [undefined, "", [], 1]) {
    assert.equal((await invoke("/api/plaid/remove", { itemId })).status, 400);
  }
});

test("disconnect failure returns error; retry succeeds and removes accounts correctly", async () => {
  await fixture();
  await routes();
  const before = await snapshot();
  const original = globalThis.fetch;
  process.env.PLAID_CLIENT_ID = "dummy-client";
  process.env.PLAID_SECRET = "dummy-secret";
  try {
    globalThis.fetch = async () => { throw new Error("dummy revocation failure"); };
    assert.equal((await invoke("/api/plaid/remove", { itemId: "bank-a" })).status, 502);
    assert.deepEqual(await snapshot(), before);
    globalThis.fetch = async () => mockResponse();
    const result = await invoke("/api/plaid/remove", { itemId: "bank-a" });
    assert.equal(result.status, 200);
    assert.deepEqual(result.payload.accounts.map((a: any) => a.itemId), ["bank-b"]);
    assert.ok(result.payload.items.every((i: any) => !("accessToken" in i)));
  } finally {
    globalThis.fetch = original;
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
  }
});

test("disconnect-all reports partial failure and retains failed bank plus demo records", async () => {
  await fixture();
  process.env.NODE_ENV = "test";
  await seedDemoData();
  await routes();
  const original = globalThis.fetch;
  process.env.PLAID_CLIENT_ID = "dummy-client";
  process.env.PLAID_SECRET = "dummy-secret";
  const tokens: string[] = [];
  try {
    globalThis.fetch = async (_url, init) => {
      const token = JSON.parse(String(init?.body)).access_token;
      tokens.push(token);
      if (token === "dummy-bank-b") throw new Error("dummy outage");
      return mockResponse();
    };
    const first = await invoke("/api/demo/clear", { confirm: "disconnect-all" });
    assert.equal(first.status, 502);
    assert.match(first.payload.message, /others may already be disconnected/);
    const after = await snapshot();
    assert.deepEqual(after.items.map(i => i.id), ["bank-b", "demo"]);
    assert.ok(after.accounts.some(a => a.itemId === "bank-b"));
    assert.ok(after.transactions.some(t => t.itemId === "bank-b"));
    assert.equal(after.accounts.filter(a => a.itemId === "demo").length, 3);
    assert.deepEqual(tokens, ["dummy-bank-a", "dummy-bank-b"]);
    globalThis.fetch = async () => mockResponse();
    assert.equal((await invoke("/api/demo/clear", { confirm: "disconnect-all" })).status, 200);
    assert.deepEqual((await snapshot()).items.map(i => i.id), ["demo"]);
  } finally {
    globalThis.fetch = original;
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
  }
});

test("API network failures never become sample data or fake mutation success", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("dummy offline"); };
    for (const action of [api.config, api.state, api.seedDemo, api.clearReal, () => api.removeItem("bank-a")]) {
      await assert.rejects(action(), /dummy offline/);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("API 404/405 remain errors; authentication errors are preserved", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [404, 405]) {
      globalThis.fetch = async () => mockResponse(status, "dummy unavailable");
      await assert.rejects(api.state(), /dummy unavailable/);
      await assert.rejects(api.clearReal(), /dummy unavailable/);
    }
    globalThis.fetch = async () => mockResponse(401, "locked");
    await assert.rejects(apiJson("/api/state"), LockedError);
    globalThis.fetch = async () => mockResponse(429, "limited");
    await assert.rejects(api.state(), /Too many attempts/);
  } finally {
    globalThis.fetch = original;
  }
});

test("client no longer overrides fetch and blocks shell on config failure", () => {
  const source = readFileSync("client/src/App.tsx", "utf8");
  assert.doesNotMatch(source, /window\.fetch\s*=|previewResponseFor|PREVIEW_STATE/);
  assert.match(source, /if \(config\.isError \|\| !config\.data\)/);
  assert.match(source, /Could not reach Card Tracker/);
  const connect = readFileSync("client/src/pages/SettingsPage.tsx", "utf8");
  assert.match(connect, /config\.data\?\.demoEnabled/);
  assert.match(connect, /window\.confirm\(`Disconnect/);
  assert.match(connect, /window\.confirm\("Disconnect all banks/);
});

async function providerCheck(run: () => Promise<void>, handler: (path: string, body: any) => any) {
  const original = globalThis.fetch;
  process.env.PLAID_CLIENT_ID = "dummy-client";
  process.env.PLAID_SECRET = "dummy-secret";
  globalThis.fetch = async (url, init) => {
    assert.ok(init?.signal, "provider requests must have a timeout");
    return handler(new URL(String(url)).pathname, JSON.parse(String(init?.body)));
  };
  try { await run(); } finally {
    globalThis.fetch = original;
    delete process.env.PLAID_CLIENT_ID;
    delete process.env.PLAID_SECRET;
  }
}
const balances = () => ({
  accounts: [{ account_id: "account-bank-a", name: "Dummy card", type: "credit",
    balances: { current: 45.67, limit: 1000, iso_currency_code: "USD" } }],
});
const liabilities = () => ({ liabilities: { credit: [{
  account_id: "account-bank-a", minimum_payment_amount: 12.34,
  next_payment_due_date: "2026-12-01", last_statement_balance: 40,
}] } });
const delta = (patch: Record<string, unknown> = {}) => ({
  added: [], modified: [], removed: [], next_cursor: "complete-cursor", has_more: false, ...patch,
});
const transaction = (id: string, amount: number, patch: Record<string, unknown> = {}) => ({
  transaction_id: id, account_id: "account-bank-a", amount,
  date: "2026-11-01", name: "Updated dummy merchant", pending: false, ...patch,
});
function standardProvider(path: string) {
  if (path === "/accounts/balance/get") return mockResponse(200, JSON.stringify(balances()));
  if (path === "/liabilities/get") return mockResponse(200, JSON.stringify(liabilities()));
  throw new Error(`Unexpected mocked path ${path}`);
}

test("sync applies modified/removal objects and reconciles pending transactions without crossing banks", async () => {
  await fixture();
  await providerCheck(async () => {
    await syncItem("bank-a");
    const after = await snapshot();
    assert.equal(after.transactions.find(t => t.id === "txn-bank-a")?.amountCents, 987);
    assert.ok(after.transactions.some(t => t.id === "txn-bank-b"), "another bank's rows must survive");
    assert.ok(!after.transactions.some(t => t.id === "pending-a"));
    assert.ok(after.transactions.some(t => t.id === "posted-a"));
    assert.equal(after.accounts.find(a => a.id === "account-bank-a")?.minDueCents, 1234);
    assert.equal(after.items.find(i => i.id === "bank-a")?.cursor, "complete-cursor");
  }, path => path === "/transactions/sync" ? mockResponse(200, JSON.stringify(delta({
    added: [transaction("pending-a", 5, { pending: true }), transaction("posted-a", 5, { pending_transaction_id: "pending-a" })],
    modified: [transaction("txn-bank-a", 9.87)],
    removed: [{ transaction_id: "txn-bank-b", account_id: "account-bank-b" }],
  }))) : standardProvider(path));
});

test("same-bank removed transaction object actually deletes its row", async () => {
  await fixture();
  await providerCheck(async () => {
    await syncItem("bank-a");
    assert.ok(!(await snapshot()).transactions.some(t => t.id === "txn-bank-a"));
  }, path => path === "/transactions/sync"
    ? mockResponse(200, JSON.stringify(delta({ removed: [{ transaction_id: "txn-bank-a", account_id: "account-bank-a" }] })))
    : standardProvider(path));
});

test("failed second page leaves accounts, transactions, payment facts and cursor unchanged", async () => {
  await fixture();
  const before = await snapshot();
  await providerCheck(async () => {
    await assert.rejects(syncItem("bank-a"));
    assert.deepEqual(await snapshot(), before);
  }, (path, body) => {
    if (path !== "/transactions/sync") return standardProvider(path);
    if (body.cursor) throw new Error("dummy page outage");
    return mockResponse(200, JSON.stringify(delta({
      added: [transaction("must-not-appear", 99)], next_cursor: "page-two", has_more: true,
    })));
  });
});

test("liability failure preserves all previously displayed payment facts", async () => {
  await fixture();
  await db.update(accounts).set({ minDueCents: 999, dueDate: "2026-12-01" });
  const before = await snapshot();
  await providerCheck(async () => {
    await assert.rejects(syncItem("bank-a"));
    assert.deepEqual(await snapshot(), before);
  }, path => {
    if (path === "/liabilities/get") throw new Error("dummy unavailable liabilities");
    return standardProvider(path);
  });
});

test("pagination mutation restarts from original cursor and discards the abandoned pages", async () => {
  await fixture();
  const cursors: unknown[] = [];
  let restarted = false;
  await providerCheck(async () => {
    await syncItem("bank-a");
    assert.deepEqual(cursors, [undefined, "page-two", undefined]);
    const after = await snapshot();
    assert.ok(!after.transactions.some(t => t.id === "abandoned"));
    assert.ok(after.transactions.some(t => t.id === "fresh"));
  }, (path, body) => {
    if (path !== "/transactions/sync") return standardProvider(path);
    cursors.push(body.cursor);
    if (body.cursor === "page-two") {
      restarted = true;
      return mockResponse(400, JSON.stringify({ error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" }));
    }
    return mockResponse(200, JSON.stringify(delta(restarted
      ? { added: [transaction("fresh", 2)] }
      : { added: [transaction("abandoned", 1)], next_cursor: "page-two", has_more: true })));
  });
});

test("an in-flight sync cannot resurrect a bank deleted while waiting for upstream", async () => {
  await fixture();
  await providerCheck(async () => {
    await syncItem("bank-a");
    const after = await snapshot();
    assert.ok(!after.items.some(i => i.id === "bank-a"));
    assert.ok(!after.accounts.some(a => a.itemId === "bank-a"));
    assert.ok(!after.transactions.some(t => t.itemId === "bank-a"));
  }, async path => {
    if (path !== "/transactions/sync") return standardProvider(path);
    await disconnectItem(db, await bank(), async () => ({}));
    return mockResponse(200, JSON.stringify(delta({ added: [transaction("no-resurrection", 1)] })));
  });
});

test("linking saves encrypted token before optional metadata and reports initial-sync failure honestly", async () => {
  await fixture();
  await routes();
  await providerCheck(async () => {
    const result = await invoke("/api/plaid/exchange", { public_token: "dummy-public" });
    assert.equal(result.status, 200);
    assert.match(result.payload.warnings[0], /initial sync did not complete/);
    const saved = await bank("bank-new");
    assert.ok(saved.accessToken.startsWith("v1:"));
    assert.equal(decryptAccessToken(saved.accessToken), "dummy-new-token");
    assert.ok(!JSON.stringify(result.payload).includes("dummy-new-token"));
  }, path => {
    if (path === "/item/public_token/exchange") {
      return mockResponse(200, JSON.stringify({ item_id: "bank-new", access_token: "dummy-new-token" }));
    }
    throw new Error("dummy metadata or initial sync outage");
  });
});

test("failed link persistence compensates by revoking the new grant", async () => {
  await fixture();
  await routes();
  await db.run(sql`CREATE TRIGGER fail_dummy_link BEFORE INSERT ON items
    WHEN NEW.id = 'bank-new' BEGIN SELECT RAISE(ABORT, 'dummy save failure'); END`);
  let revoked = false;
  try {
    await providerCheck(async () => {
      const result = await invoke("/api/plaid/exchange", { public_token: "dummy-public" });
      assert.equal(result.status, 502);
      assert.equal(result.payload.code, "LINK_NOT_SAVED");
      assert.ok(revoked);
      assert.equal(await bank("bank-new"), undefined);
    }, (path, body) => {
      if (path === "/item/public_token/exchange") return mockResponse(200, JSON.stringify({ item_id: "bank-new", access_token: "dummy-new-token" }));
      assert.equal(path, "/item/remove");
      assert.equal(body.access_token, "dummy-new-token");
      revoked = true;
      return mockResponse();
    });
  } finally {
    await db.run(sql`DROP TRIGGER fail_dummy_link`);
  }
});

test("authenticated encryption detects tampering and wrong keys", () => {
  process.env.TOKEN_ENCRYPTION_KEY = "dummy-test-encryption-key-not-for-production";
  const encrypted = encryptAccessToken("dummy-private-token");
  assert.ok(!encrypted.includes("dummy-private-token"));
  assert.equal(decryptAccessToken(encrypted), "dummy-private-token");
  const pieces = encrypted.split(":");
  const ciphertext = Buffer.from(pieces[3], "base64url");
  ciphertext[0] ^= 1;
  pieces[3] = ciphertext.toString("base64url");
  assert.throws(() => decryptAccessToken(pieces.join(":")));
  process.env.TOKEN_ENCRYPTION_KEY = "another-dummy-test-key-not-for-production";
  assert.throws(() => decryptAccessToken(encrypted));
  process.env.TOKEN_ENCRYPTION_KEY = "dummy-test-encryption-key-not-for-production";
});

test("production config rejects short/numeric passwords and absent encryption key", () => {
  const env = {
    NODE_ENV: "production", APP_PIN: "dummy-long-test-password",
    PLAID_CLIENT_ID: "dummy-client", PLAID_SECRET: "dummy-secret",
    TOKEN_ENCRYPTION_KEY: "dummy-long-test-key-never-use-in-production",
  };
  assert.doesNotThrow(() => validateProductionConfig(env));
  assert.throws(() => validateProductionConfig({ ...env, APP_PIN: "1234" }));
  assert.throws(() => validateProductionConfig({ ...env, APP_PIN: "1".repeat(30) }));
  assert.throws(() => validateProductionConfig({ ...env, TOKEN_ENCRYPTION_KEY: undefined }));
  assert.throws(() => validateProductionConfig({ ...env, PLAID_ENV: "typo" }));
});

test("state never exposes cursors/tokens, real connections hide demo fixtures", async () => {
  await fixture();
  await seedDemoData();
  await db.update(items).set({ cursor: "dummy-private-cursor" }).where(eq(items.id, "bank-a"));
  await routes();
  const { payload } = await invoke("/api/state", undefined, "GET");
  assert.equal(payload.items.length, 2);
  assert.ok(payload.items.every((i: any) => !i.isDemo && !("accessToken" in i) && !("cursor" in i)));
  assert.ok(payload.accounts.every((a: any) => a.itemId !== "demo"));
  assert.ok(payload.transactions.every((t: any) => t.itemId !== "demo"));
  assert.ok(!JSON.stringify(payload).includes("dummy-private-cursor"));
});

test("client 401 clears the in-memory password and emits the lock event", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let event = "";
  globalThis.window = { dispatchEvent: (e: Event) => { event = e.type; return true; } } as Window & typeof globalThis;
  globalThis.fetch = async () => mockResponse(401);
  setPin("dummy-unlocked-password");
  try {
    await assert.rejects(api.state(), LockedError);
    assert.equal(getPin(), "");
    assert.equal(event, "card-tracker:locked");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    setPin("");
  }
});

test("missing account snapshot cannot mark retained balances as freshly synced", async () => {
  await fixture();
  const before = await snapshot();
  await providerCheck(async () => {
    await assert.rejects(syncItem("bank-a"), /Account access changed/);
    assert.deepEqual(await snapshot(), before);
  }, path => {
    if (path === "/accounts/balance/get") return mockResponse(200, JSON.stringify({ accounts: [] }));
    if (path === "/transactions/sync") return mockResponse(200, JSON.stringify(delta()));
    return standardProvider(path);
  });
});

test("unknown balance cannot silently reuse old numbers and advance complete-sync time", async () => {
  await fixture();
  const before = await snapshot();
  await providerCheck(async () => {
    await assert.rejects(syncItem("bank-a"), /balance is unavailable/);
    assert.deepEqual(await snapshot(), before);
  }, path => {
    if (path === "/accounts/balance/get") {
      const data: any = balances();
      data.accounts[0].balances.current = null;
      return mockResponse(200, JSON.stringify(data));
    }
    if (path === "/transactions/sync") return mockResponse(200, JSON.stringify(delta()));
    return standardProvider(path);
  });
});

test("production legacy plaintext tokens fail closed without contacting provider or deleting", async () => {
  await fixture();
  await db.update(items).set({ accessToken: "dummy-legacy-plaintext" }).where(eq(items.id, "bank-a"));
  process.env.NODE_ENV = "production";
  const before = await snapshot();
  await providerCheck(async () => {
    await assert.rejects(syncItem("bank-a"), /legacy bank token/);
    await assert.rejects(disconnectItem(db, await bank(), async () => assert.fail("must not call provider")), DisconnectError);
    assert.deepEqual(await snapshot(), before);
  }, () => assert.fail("legacy token must never be sent to provider"));
});

test("revocation-marker write failure retains records but does not pretend outcome recovery succeeded", async () => {
  await fixture();
  const before = await snapshot();
  await db.run(sql`CREATE TRIGGER fail_dummy_marker BEFORE UPDATE OF access_token ON items
    WHEN NEW.access_token LIKE 'revoked:%' BEGIN SELECT RAISE(ABORT, 'dummy marker failure'); END`);
  let upstreamAcknowledged = false;
  try {
    await assert.rejects(disconnectItem(db, await bank(), async () => { upstreamAcknowledged = true; }));
    assert.ok(upstreamAcknowledged);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await db.run(sql`DROP TRIGGER fail_dummy_marker`);
  }
  // Provider semantics for a second removal are not assumed. A rejected retry
  // keeps records and requires owner-side reconciliation, as documented.
  await assert.rejects(disconnectItem(db, await bank(), async () => { throw new Error("dummy already absent"); }), DisconnectError);
  assert.deepEqual(await snapshot(), before);
});

test("stored production samples default hidden; repeated display toggles preserve every database row", async () => {
  await fixture();
  await db.delete(transactions);
  await db.delete(accounts);
  await db.delete(items);
  await seedDemoData();
  await routes();
  const before = await snapshot();
  for (const show of [false, true, false, true, false]) {
    const headers = show ? { "x-show-samples": "true" } : {};
    const { payload } = await invoke("/api/state", undefined, "GET", headers);
    assert.equal(payload.sampleDataAvailable, true);
    assert.equal(payload.items.length, show ? 1 : 0);
    assert.equal(payload.accounts.length, show ? 3 : 0);
    assert.equal(payload.transactions.length, show ? before.transactions.length : 0);
    assert.deepEqual(await snapshot(), before);
  }
  for (const value of ["false", "1", "TRUE"]) {
    const { payload } = await invoke("/api/state", undefined, "GET", { "x-show-samples": value });
    assert.equal(payload.accounts.length, 0);
  }
});

test("sample opt-in works with active banks and no stored samples, without leaking or writing real data", async () => {
  await fixture();
  await routes();
  await invoke("/api/accounts/nickname", { accountId: "account-bank-a", nickname: "Private test label" });
  await invoke("/api/accounts/reward-rules", { accountId: "account-bank-a", productId: "amex-gold-us" });
  const before = await snapshot();
  const { payload } = await invoke("/api/state", undefined, "GET", { "x-show-samples": "true" });
  assert.equal(payload.sampleDataAvailable, true);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.accounts.length, 3);
  assert.ok(payload.items.every((i: any) => i.isDemo));
  assert.ok(payload.accounts.every((a: any) => a.itemId === "demo" && a.rewardRules));
  assert.ok(payload.transactions.every((t: any) => t.itemId === "demo"));
  assert.doesNotMatch(JSON.stringify(payload), /bank-a|bank-b|Private test label|amex-gold-us|accessToken/);
  const real = (await invoke("/api/state", undefined, "GET")).payload;
  assert.deepEqual(real.accounts.map((a: any) => a.itemId).sort(), ["bank-a", "bank-b"]);
  assert.deepEqual(await snapshot(), before);
});

test("sample requests cannot link, sync, rename, edit rewards or disconnect real accounts", async () => {
  await fixture();
  await routes();
  const before = await snapshot();
  for (const [path, body] of [
    ["/api/plaid/link-token", undefined],
    ["/api/plaid/exchange", { public_token: "dummy-link" }],
    ["/api/plaid/sync", undefined],
    ["/api/plaid/remove", { itemId: "bank-a" }],
    ["/api/demo/clear", { confirm: "disconnect-all" }],
    ["/api/accounts/nickname", { accountId: "account-bank-a", nickname: "No" }],
    ["/api/accounts/reward-rules", { accountId: "account-bank-a", productId: "amex-gold-us" }],
  ] as const) {
    const { payload, status } = await invoke(path, body, "POST", { "x-show-samples": "true" });
    assert.equal(status, 403);
    assert.match(payload.message, /read-only/);
    assert.doesNotMatch(JSON.stringify(payload), /bank-a|bank-b/);
  }
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await db.select().from(rewardProfiles), []);
});

test("sample visibility is sent explicitly and resets when locked or authentication is rejected", async () => {
  const original = globalThis.fetch;
  const flags: string[] = [];
  let reject = false;
  globalThis.fetch = async (_url, init) => {
    flags.push((init?.headers as Record<string, string>)["x-show-samples"]);
    return mockResponse(reject ? 401 : 200);
  };
  try {
    assert.equal(getShowSamples(), false);
    await api.state();
    setShowSamples(true);
    await api.state();
    setPin("");
    assert.equal(getShowSamples(), false);
    await api.state();
    setShowSamples(true);
    reject = true;
    await assert.rejects(api.state(), LockedError);
    assert.equal(getShowSamples(), false);
    assert.deepEqual(flags, ["false", "true", "false", "true"]);
  } finally {
    globalThis.fetch = original;
    setPin("");
  }
});

test("nickname storage startup is additive and idempotent without changing financial rows", async () => {
  await fixture();
  const before = await snapshot();
  await ensureSchema();
  await ensureSchema();
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await db.select().from(accountPreferences), []);
});

test("rename persists a trimmed nickname without modifying bank data or another card", async () => {
  await fixture();
  await routes();
  const before = await snapshot();
  const result = await invoke("/api/accounts/nickname", { accountId: "account-bank-a", nickname: "  My everyday card  " });
  assert.equal(result.status, 200);
  const renamed = result.payload.accounts.find((a: any) => a.id === "account-bank-a");
  assert.equal(renamed.name, "bank-a");
  assert.equal(renamed.nickname, "My everyday card");
  assert.equal(cardName(renamed), "My everyday card");
  assert.equal(result.payload.accounts.find((a: any) => a.id === "account-bank-b").nickname, null);
  assert.deepEqual(await snapshot(), before);
  await ensureSchema();
  const refreshed = await invoke("/api/state", undefined, "GET");
  assert.equal(refreshed.payload.accounts.find((a: any) => a.id === renamed.id).nickname, "My everyday card");
  assert.ok(refreshed.payload.items.every((i: any) => !("accessToken" in i)));
});

test("replacing or clearing a nickname affects just that account and restores its bank name", async () => {
  await fixture();
  await routes();
  await invoke("/api/accounts/nickname", { accountId: "account-bank-a", nickname: "First label" });
  await invoke("/api/accounts/nickname", { accountId: "account-bank-b", nickname: "Keep this label" });
  await invoke("/api/accounts/nickname", { accountId: "account-bank-a", nickname: "Updated label" });
  assert.equal((await db.select().from(accountPreferences)).length, 2);
  const cleared = await invoke("/api/accounts/nickname", { accountId: "account-bank-a", nickname: "   " });
  assert.equal(cleared.status, 200);
  const card = cleared.payload.accounts.find((a: any) => a.id === "account-bank-a");
  assert.equal(card.nickname, null);
  assert.equal(cardName(card), "bank-a");
  assert.equal((await db.select().from(accountPreferences))[0].nickname, "Keep this label");
});

test("invalid nickname requests and unknown cards cannot mutate stored labels", async () => {
  await fixture();
  await routes();
  await invoke("/api/accounts/nickname", { accountId: "account-bank-a", nickname: "Keep" });
  const before = await snapshot();
  const preferences = await db.select().from(accountPreferences);
  for (const body of [
    {}, { accountId: [], nickname: "Label" }, { accountId: "", nickname: "Label" },
    { accountId: "account-bank-a", nickname: null },
    { accountId: "account-bank-a", nickname: "x".repeat(81) },
    { accountId: "account-bank-a", nickname: "line\nbreak" },
    { accountId: "account-bank-a", nickname: "bad\u0000label" },
  ]) {
    assert.equal((await invoke("/api/accounts/nickname", body)).status, 400);
  }
  assert.equal((await invoke("/api/accounts/nickname", { accountId: "not-a-card", nickname: "No" })).status, 404);
  assert.deepEqual(await snapshot(), before);
  assert.deepEqual(await db.select().from(accountPreferences), preferences);
});

test("bank synchronization updates the provider name without overwriting the personal nickname", async () => {
  await fixture();
  await routes();
  await invoke("/api/accounts/nickname", { accountId: "account-bank-a", nickname: "My renamed card" });
  await providerCheck(async () => {
    await syncItem("bank-a");
    const { payload } = await invoke("/api/state", undefined, "GET");
    const card = payload.accounts.find((a: any) => a.id === "account-bank-a");
    assert.equal(card.name, "Dummy card");
    assert.equal(card.nickname, "My renamed card");
    assert.equal(cardName(card), "My renamed card");
    assert.equal(cardName({ name: "Bank name" }), "Bank name");
  }, path => path === "/transactions/sync"
    ? mockResponse(200, JSON.stringify(delta()))
    : standardProvider(path));
});

test("disconnect preserves nicknames on failure and cleans only the selected bank on successful retry", async () => {
  await fixture();
  await db.insert(accountPreferences).values([
    { accountId: "account-bank-a", nickname: "First" },
    { accountId: "account-bank-b", nickname: "Second" },
  ]);
  await assert.rejects(disconnectItem(db, await bank(), async () => { throw new Error("dummy revoke failure"); }));
  assert.equal((await db.select().from(accountPreferences)).length, 2);
  await db.run(sql`CREATE TRIGGER fail_dummy_nickname_cleanup BEFORE DELETE ON accounts
    BEGIN SELECT RAISE(ABORT, 'dummy cleanup failure'); END`);
  try {
    await assert.rejects(disconnectItem(db, await bank(), async () => ({})));
    assert.equal((await db.select().from(accountPreferences)).length, 2);
  } finally {
    await db.run(sql`DROP TRIGGER fail_dummy_nickname_cleanup`);
  }
  await disconnectItem(db, await bank(), async () => assert.fail("already revoked"));
  assert.deepEqual(await db.select().from(accountPreferences), [
    { accountId: "account-bank-b", nickname: "Second" },
  ]);
});

test("nickname client uses the protected API and preserves literal names in JSON", async () => {
  const original = globalThis.fetch;
  let observedPath = "";
  let observedBody = "";
  globalThis.fetch = async (url, init) => {
    observedPath = String(url);
    observedBody = String(init?.body);
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["x-app-pin"], "dummy-nickname-password");
    return mockResponse();
  };
  try {
    setPin("dummy-nickname-password");
    await api.renameCard("account-bank-a", 'Travel & "rewards"');
    assert.equal(observedPath, "/api/accounts/nickname");
    assert.deepEqual(JSON.parse(observedBody), { accountId: "account-bank-a", nickname: 'Travel & "rewards"' });
  } finally {
    globalThis.fetch = original;
    setPin("");
  }
});

test("failed nickname persistence keeps the old nickname and every financial record", async () => {
  await fixture();
  await routes();
  await invoke("/api/accounts/nickname", { accountId: "account-bank-a", nickname: "Original nickname" });
  const before = await snapshot();
  const preferences = await db.select().from(accountPreferences);
  await db.run(sql`CREATE TRIGGER fail_dummy_nickname_save BEFORE UPDATE ON account_preferences
    BEGIN SELECT RAISE(ABORT, 'dummy save failure'); END`);
  try {
    const result = await invoke("/api/accounts/nickname", { accountId: "account-bank-a", nickname: "Must not save" });
    assert.equal(result.status, 500);
    assert.equal(result.payload.message, "Server error");
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await db.select().from(accountPreferences), preferences);
  } finally {
    await db.run(sql`DROP TRIGGER fail_dummy_nickname_save`);
  }
});

test("reward product selection, switching, custom rates and clearing scope to a single connected card", async () => {
  await fixture();
  await routes();
  const path = "/api/accounts/reward-rules";
  const accountId = "account-bank-a";
  const before = await snapshot();
  const current = async () => (await invoke("/api/state", undefined, "GET")).payload.accounts.find((a: any) => a.id === accountId);
  assert.equal((await invoke(path, { accountId, productId: "amex-gold-us" })).status, 200);
  assert.equal((await current()).rewardRules.potential.Dining, 4);
  assert.equal((await invoke(path, { accountId, productId: "amex-cobalt-ca" })).status, 400);
  assert.equal((await invoke(path, { accountId, productId: "missing" })).status, 400);
  assert.equal((await invoke(path, { accountId, productId: "amex-gold-us", rules: null })).status, 400);
  assert.equal((await current()).rewardProductId, "amex-gold-us");
  assert.equal((await invoke(path, { accountId, productId: "chase-sapphire-preferred-us" })).status, 200);
  assert.equal((await current()).rewardRules.bonuses.Dining, 3);
  assert.equal((await invoke(path, { accountId, rules: { unit: "Miles", base: -5, bonuses: {} } })).status, 400);
  assert.equal((await invoke(path, { accountId, rules: { productName: "Example Altitude Card", unit: "Miles", base: 2, bonuses: { Travel: 3 } } })).status, 200);
  assert.equal((await current()).rewardProductId, null);
  assert.equal((await current()).rewardRules.productName, "Example Altitude Card");
  assert.equal((await current()).rewardRules.bonuses.Travel, 3);
  assert.equal((await invoke(path, { accountId: "missing", rules: null })).status, 404);
  assert.equal((await invoke(path, { accountId, rules: null })).status, 200);
  assert.equal((await current()).rewardRules, undefined);
  assert.deepEqual(await snapshot(), before);
});

test("free catalog starts empty and finds issuer variants without fabricating rates", async () => {
  await fixture();
  await routes();
  assert.deepEqual(searchRewardCatalog(" ", "USD"), []);
  assert.deepEqual(searchRewardCatalog("Free Hilton Amex", "USD").map(p => p.id), ["amex-hilton-honors-us"]);
  assert.equal(searchRewardCatalog("Chase United", "USD").length, 6);
  assert.ok(searchRewardCatalog("American Express Business", "USD").some(p => p.id === "amex-delta-reserve-business-us"));
  assert.deepEqual(searchRewardCatalog("Hilton Honors", "CAD"), []);
  const accountId = "account-bank-a";
  const { id } = searchRewardCatalog("Chase United Gateway", "USD")[0];
  assert.equal((await invoke("/api/accounts/reward-rules", { accountId, productId: id })).status, 200);
  const { payload } = await invoke("/api/state", undefined, "GET");
  const card = payload.accounts.find((a: any) => a.id === accountId);
  assert.equal(card.rewardProductId, id);
  assert.equal(card.rewardRules, undefined);
  assert.equal(rewardEstimate(card, 10000, "Travel", "USD"), null);
});

test("issuer refresh uses only public URLs, changes rewards metadata, and retains it on failed checks", async () => {
  await fixture();
  await routes();
  const chaseId = "chase-sapphire-preferred-us";
  const hiltonId = "amex-hilton-honors-us";
  const path = "/api/issuer-rewards/sync";
  await invoke("/api/accounts/reward-rules", { accountId: "account-bank-a", productId: chaseId });
  await invoke("/api/accounts/reward-rules", { accountId: "account-bank-b", productId: hiltonId });
  const before = await snapshot();
  const chase = `<p>You&rsquo;ll earn 1 point for each $1 spent on all other purchases.</p>
    <p>You'll earn 2 points for each $1 spent on purchases made in the travel category (excluding purchases made through Chase Travel that qualify for 6 points as described).</p>
    <p>You'll earn <strong>6</strong> points for each $1 spent on purchases made using your card through Chase Travel.</p>
    <p>You'll earn 3 points for each $1 spent on purchases in the following rewards categories: vacation homes at top brands; gas stations; electric vehicle charging; dining at restaurants including takeout and eligible delivery services; top streaming services; online grocery (excluding Target, Walmart and wholesale clubs).</p>`;
  const hilton = `<p>Earn 4X Hilton Honors Bonus Points for all other eligible purchases on your Card.</p>
    <p>Earn 7X Hilton Honors Bonus Points for each dollar of eligible purchases charged on your Card directly with a hotel or resort within the Hilton portfolio.</p>
    ${["restaurants", "supermarkets", "gas stations"].map(category =>
      `<p>Earn 5X Hilton Honors Bonus Points for each dollar of eligible purchases on your Card at U.S. ${category}.</p>`).join("")}`;
  const mockPage = (html: string) => {
    let read = false;
    return {
      ok: true, headers: { get: () => "text/html; charset=utf-8" },
      body: { getReader: () => ({
        read: async () => read ? { done: true } : (read = true, { done: false, value: new TextEncoder().encode(html) }),
        cancel: async () => {},
      }) },
    } as unknown as Response;
  };
  const original = globalThis.fetch;
  const now = Date.now;
  const urls: string[] = [];
  let broken = false;
  Date.now = () => Date.parse("2027-01-01T00:00:00Z") + (broken ? 360_000 : 0);
  try {
    globalThis.fetch = async (url, init) => {
      urls.push(String(url));
      const source = issuerRewardSources.find(s => s.url === String(url));
      assert.ok(source);
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.body, undefined);
      assert.deepEqual(init?.headers, { Accept: "text/html" });
      if (source.id === chaseId) return mockPage(broken ? chase + chase.replace(">6<", ">8<") : chase);
      if (source.id === hiltonId) return broken ? mockResponse(503) : mockPage(hilton);
      return mockPage("No matching listing");
    };
    assert.equal((await invoke(path, {}, "POST", { "x-show-samples": "true" })).status, 403);
    assert.equal(urls.length, 0);
    const good = await invoke(path, { url: "https://ignored.invalid", accountId: "account-bank-a" });
    assert.equal(good.status, 200);
    assert.deepEqual(urls, issuerRewardSources.map(s => s.url));
    assert.equal(good.payload.find((row: any) => row.source.id === chaseId).check.status, "rates-refreshed");
    assert.equal(good.payload.find((row: any) => row.source.id === hiltonId).check.status, "rates-refreshed");
    assert.equal((await invoke(path, {})).status, 429);
    broken = true;
    const failed = await invoke(path, {});
    assert.equal(failed.status, 200);
    assert.equal(failed.payload.find((row: any) => row.source.id === chaseId).check.status, "needs-review");
    assert.equal(failed.payload.find((row: any) => row.source.id === hiltonId).check.status, "unavailable");
    const { payload } = await invoke("/api/state", undefined, "GET");
    assert.equal(payload.accounts.find((a: any) => a.id === "account-bank-a").rewardRules.potential.Travel, 6);
    assert.equal(payload.accounts.find((a: any) => a.id === "account-bank-b").rewardRules.base, 4);
    assert.ok(payload.accounts.every((a: any) => a.rewardRatesCheckedAt));
    assert.deepEqual(await snapshot(), before);
  } finally {
    globalThis.fetch = original;
    Date.now = now;
  }
});

test("rewards compare same currency by program, preserve uncertain ranges and skip non-purchases", async () => {
  await fixture();
  const s = await snapshot();
  const source = s.accounts[0];
  const products = ["amex-gold-us", "chase-freedom-unlimited-us", "chase-sapphire-preferred-us", "amex-cobalt-ca"];
  const cards = products.map(id => {
    const product = findRewardProduct(id)!;
    return { ...source, id, currency: product.currency, rewardRules: product.rules };
  });
  const groups = rewardGroups(cards, 10000, "Dining", "USD");
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(g => [g[0].value, g[0].upper]), [[100, 400], [300, 300], [300, 300]]);
  assert.equal(rewardEstimate(cards[3], 10000, "Dining", "USD"), null);
  const txn = { ...s.transactions[0], category: "Dining" };
  assert.ok(purchaseEligible(txn));
  for (const adjustment of [{ amountCents: -100 }, { pending: true }, { category: "Fees" }, { category: "Payment" }, { category: "Other" }]) {
    assert.equal(purchaseEligible({ ...txn, ...adjustment }), false);
  }
});

test("sync status is scoped to a bank, survives a failed sync, and is cleaned up on disconnect", async () => {
  await fixture();
  await routes();
  await db.update(items).set({ lastSyncedAt: "2026-10-01T00:00:00Z" }).where(eq(items.id, "bank-a"));
  await invoke("/api/accounts/reward-rules", { accountId: "account-bank-a", productId: "amex-gold-us" });
  await invoke("/api/accounts/reward-rules", { accountId: "account-bank-b", productId: "amex-gold-us" });
  const last = await snapshot();
  await providerCheck(async () => {
    await assert.rejects(syncItem("bank-a"));
    assert.deepEqual(await snapshot(), last);
  }, () => mockResponse(400, JSON.stringify({ error_code: "ITEM_LOGIN_REQUIRED" })));
  const state = (await invoke("/api/state", undefined, "GET")).payload;
  assert.equal(state.items.find((i: any) => i.id === "bank-a").syncIssue, "reconnect");
  assert.equal(state.items.find((i: any) => i.id === "bank-a").lastSyncedAt, "2026-10-01T00:00:00Z");
  assert.equal(state.items.find((i: any) => i.id === "bank-b").syncIssue, undefined);
  await disconnectItem(db, await bank(), async () => {});
  assert.deepEqual((await db.select().from(rewardProfiles)).map(r => r.accountId), ["account-bank-b"]);
  assert.deepEqual(await db.select().from(syncIssues), []);
});

test("a complete sync clears prior failure, records grocery detail and safely handles legacy categories", async () => {
  await fixture();
  await routes();
  await db.insert(syncIssues).values({ itemId: "bank-a", status: "failed" });
  await invoke("/api/accounts/reward-rules", { accountId: "account-bank-a", productId: "chase-sapphire-preferred-us" });
  await providerCheck(() => syncItem("bank-a"), path => path === "/transactions/sync"
    ? mockResponse(200, JSON.stringify(delta({ added: [
        transaction("groceries", 10, { iso_currency_code: "USD", personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" } }),
      ] })))
    : standardProvider(path));
  const { payload } = await invoke("/api/state", undefined, "GET");
  const card = payload.accounts.find((a: any) => a.id === "account-bank-a");
  const item = payload.items.find((i: any) => i.id === "bank-a");
  const txn = payload.transactions.find((t: any) => t.id === "groceries");
  assert.equal(item.syncIssue, undefined);
  assert.ok(item.lastSyncedAt);
  assert.equal(txn.category, "Groceries");
  assert.deepEqual(txn.rewardContext, { currency: "USD", detailedCategory: "FOOD_AND_DRINK_GROCERIES" });
  assert.equal(card.rewardProductId, "chase-sapphire-preferred-us");
  assert.equal(transactionEstimate(card, { ...txn, rewardContext: { ...txn.rewardContext, currency: "CAD" } }, "USD"), null);
  const legacy = transactionEstimate(card, { ...txn, category: "Dining", rewardContext: undefined }, "USD");
  assert.equal(legacy?.value, 10);
  assert.equal(legacy?.upper, 30);
});

test("activity shows a strictly better sample alternative, hides worse cards, and skips payments", async () => {
  await fixture();
  await routes();
  const { payload } = await invoke("/api/state", undefined, "GET", { "x-show-samples": "true" });
  const accountById = Object.fromEntries(payload.accounts.map((a: any) => [a.id, a]));
  const render = (txns: any[]) => renderToStaticMarkup(createElement(TxnList, {
    txns, accountById, rewardCards: payload.accounts, showCard: true,
  }));
  const grocery = payload.transactions.find((t: any) => t.category === "Groceries");
  const markup = render([grocery]);
  assert.match(markup, /Estimated on this card/);
  const uncertainCards = payload.accounts.map((card: any) => card.id === grocery.accountId
    ? { ...card, rewardRules: { unit: "Example points", base: 1, bonuses: {}, potential: { Groceries: 5 } } } : card);
  const uncertain = renderToStaticMarkup(createElement(TxnList, {
    txns: [grocery], accountById: Object.fromEntries(uncertainCards.map((a: any) => [a.id, a])), rewardCards: uncertainCards,
  }));
  assert.match(uncertain, /Up to .* if the purchase qualifies for the bonus/);
  assert.doesNotMatch(markup, /Better with|No other configured card/);
  const dining = payload.transactions.find((t: any) => t.category === "Dining" && t.accountId === "demo-summit");
  assert.match(render([dining]), /Better with Harbor Rewards/);
  assert.doesNotMatch(render([payload.transactions.find((t: any) => t.category === "Payment")]), /Estimated on this card/);
});

test("better-card estimates exclude equal, overlapping, rounded-equal and incomparable alternatives", async () => {
  await fixture();
  const s = await snapshot();
  const t = { ...s.transactions[0], category: "Shopping", amountCents: 1_000 };
  const original = { ...s.accounts[0], rewardRules: { unit: "Cash back", base: 2, bonuses: {}, potential: { Shopping: 3 } } };
  const cardAt = (id: string, base: number, unit = "Cash back", currency = original.currency) =>
    ({ ...original, id, currency, rewardRules: { unit, base, bonuses: {} } });
  const earned = transactionEstimate(original, t, original.currency);
  assert.ok(earned);
  const excluded = [
    cardAt(original.id, 10), cardAt("same", 2), cardAt("worse", 1), cardAt("overlap", 2.5),
    cardAt("touch", 3), cardAt("rounded", 3.01),
    cardAt("different-program", 5, "Example points"), cardAt("different-market", 5, "Cash back", "CAD"),
  ];
  assert.equal(betterTransactionAlternative(earned, excluded, t), null);
  assert.equal(betterTransactionAlternative(null, [cardAt("good", 4)], t), null);
  assert.equal(betterTransactionAlternative(earned, [...excluded, cardAt("good", 4), cardAt("best", 5)], t)?.card.id, "best");
});

test("web card search uses only a public name and market, validates drafts, and bounds provider use", async () => {
  await fixture();
  await routes();
  const path = "/api/card-products/search";
  const request = { name: "Example Altitude Card", market: "CA" };
  const original = globalThis.fetch;
  const before = await snapshot();
  let calls = 0;
  const issuer = "https://issuer.example.com/cards/altitude";
  const good = { name: "Example Altitude Card", unit: "Cash back", base: 2, bonuses: [{ category: "Dining", rate: 3 }], sourceUrl: issuer };
  try {
    globalThis.fetch = async () => assert.fail("disabled web search must not call a provider");
    assert.deepEqual((await invoke(path, request)).payload, { enabled: false, matches: [], sources: [] });
    process.env.PERPLEXITY_API_KEY = "dummy-search-key";
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(url, "https://api.perplexity.ai/v1/sonar");
      assert.equal(init?.redirect, "error");
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer dummy-search-key");
      const body = JSON.parse(String(init?.body));
      assert.match(body.messages[1].content, /"publicProductName":"Example Altitude Card","market":"Canada"/);
      assert.doesNotMatch(JSON.stringify(body), /bank-a|accountId|dummy-test-password/);
      return mockResponse(200, JSON.stringify({
        search_results: [
          { url: issuer, title: "Issuer product terms" },
          { url: "javascript:alert(1)", title: "Unsafe link" },
          { url: "https://127.0.0.1/", title: "Local link" },
        ],
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ matches: [
          good,
          { ...good, name: "Bad foreign link", sourceUrl: "https://not-from-search.example.com/" },
          { ...good, name: "Invalid rates", base: 500 },
        ] }) } }],
      }));
    };
    assert.equal((await invoke(path, { name: "Example 4111 1111 1111 1111", market: "CA" })).status, 400);
    assert.equal((await invoke(path, { ...request, accountId: "account-bank-a" })).status, 400);
    assert.equal((await invoke(path, request, "POST", { "x-show-samples": "true" })).status, 403);
    assert.equal(calls, 0);
    const reply = await invoke(path, request);
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.payload, { enabled: true, matches: [{
      name: good.name, rules: { productName: good.name, unit: "Cash back", base: 2, bonuses: { Dining: 3 } },
      source: { url: issuer, title: "Issuer product terms" },
    }], sources: [{ url: issuer, title: "Issuer product terms" }] });
    for (let i = 0; i < 3; i++) assert.equal((await invoke(path, request)).status, 200);
    assert.equal((await invoke(path, request)).status, 429);
    assert.equal(calls, 4);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await db.select().from(rewardProfiles), []);
  } finally {
    globalThis.fetch = original;
    delete process.env.PERPLEXITY_API_KEY;
  }
});

test("navigation groups linked card products and lock in Settings and the planner in Activity", async () => {
  await fixture();
  await routes();
  const { payload: real } = await invoke("/api/state", undefined, "GET");
  const { payload: sample } = await invoke("/api/state", undefined, "GET", { "x-show-samples": "true" });
  const pin = "dummy-test-password";
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  queryClient.setQueryData(["config", pin], { plaidConfigured: true });
  queryClient.setQueryData(["state", pin, false], real);
  queryClient.setQueryData(["state", pin, true], sample);
  const render = (path: string) => renderToStaticMarkup(createElement(QueryClientProvider, { client: queryClient },
    createElement(Router, { hook: useHashLocation, ssrPath: path },
      createElement(PinContext.Provider, { value: { pin, setPin: () => {} } }, createElement(Shell)))));
  try {
    const settings = render("/settings");
    assert.match(settings, /Connected banks[\s\S]*Disconnect bank-a[\s\S]*select-card-product-account-bank-a[\s\S]*Sync rewards info[\s\S]*button-lock-app/);
    assert.match(settings, /<a(?=[^>]*href="#\/settings")(?=[^>]*aria-current="page")[^>]*>/);
    assert.match(settings, /Search card catalog/);
    assert.doesNotMatch(settings, /Built-in matches|Web matches|Use this product|Possible match from Plaid/);
    assert.doesNotMatch(settings, /open-card-recommendation/);
    assert.match(render("/connect"), /Connected banks/);
    const activity = render("/activity");
    assert.match(activity, /Activity<\/h1>[\s\S]*Which card should I use\?[\s\S]*Purchase category[\s\S]*Search merchant or category/);
    assert.doesNotMatch(activity, /button-lock-app|select-card-product-account-bank-a/);
    assert.match(render("/rewards"), /<details open=""[^>]*>[\s\S]*Which card should I use\?/);
    assert.doesNotMatch(render("/"), /Which card should I use\?/);
    assert.doesNotMatch(render("/card/account-bank-a"), /Select card product/);

    setShowSamples(true);
    const sampleSettings = render("/settings");
    assert.match(sampleSettings, /Demo Bank[\s\S]*button-lock-app/);
    assert.doesNotMatch(sampleSettings, /account-bank-a|Connect a bank|Disconnect all banks|Sync rewards info/);
    const sampleActivity = render("/activity");
    assert.match(sampleActivity, /Which card should I use\?[\s\S]*Summit Travel/);
    assert.doesNotMatch(sampleActivity, /bank-a/);
  } finally {
    setShowSamples(false);
  }
});
