import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinGuard } from "./auth";

test("PIN protection, public config, throttling, expiry and cache policy", () => {
  let time = 1000;
  const guard = createPinGuard("local-test-password", { now: () => time, windowMs: 1000, maxFailures: 3 });
  const request = (path: string, pin?: string) => {
    const headers = new Map<string, string>();
    let status = 0;
    const response = {
      setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value),
      status: (value: number) => { status = value; return response; },
      json: () => response,
    };
    guard({
      path, ip: "192.0.2.1", socket: {}, get: () => pin,
    } as any, response as any, () => { status = 200; });
    return { status, headers };
  };
  assert.equal(request("/config").status, 200);
  const valid = request("/state", "local-test-password");
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("cache-control"), "no-store");
  assert.equal(request("/state").status, 401);
  assert.equal(request("/state", "wrong").status, 401);
  assert.equal(request("/state", "wrong").status, 401);
  const limited = request("/state", "local-test-password");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "1");
  assert.equal(request("/config").status, 200);
  time += 1001;
  assert.equal(request("/state", "local-test-password").status, 200);
  for (const path of ["/config/", "/Config", "/config/extra", "/unlock", "/plaid/remove"]) {
    // Only the exact public config path is exempt.
    assert.notEqual(request(path).status, 200);
  }
});
