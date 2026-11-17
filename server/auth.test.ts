import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { createPinGuard } from "./auth";

test("PIN protection, public config, throttling, expiry and cache policy", async () => {
  let time = 1000;
  const app = express();
  app.use("/api", createPinGuard("local-test-password", { now: () => time, windowMs: 1000, maxFailures: 3 }));
  app.get("/api/config", (_req, res) => res.json({ pinRequired: true }));
  app.get("/api/state", (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}`;
  const request = (path: string, pin?: string) =>
    fetch(url + path, { headers: pin ? { "x-app-pin": pin } : {} });
  try {
    assert.equal((await request("/api/config")).status, 200);
    const valid = await request("/api/state", "local-test-password");
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("cache-control"), "no-store");
    assert.equal((await request("/api/state")).status, 401);
    assert.equal((await request("/api/state", "wrong")).status, 401);
    assert.equal((await request("/api/state", "wrong")).status, 401);
    const limited = await request("/api/state", "local-test-password");
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "1");
    assert.equal((await request("/api/config")).status, 200);
    time += 1001;
    assert.equal((await request("/api/state", "local-test-password")).status, 200);
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
