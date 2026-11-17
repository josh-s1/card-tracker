import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/** Single-instance guard. Counters are in memory and reset on server restart. */
export function createPinGuard(
  pin: string | undefined,
  options: { now?: () => number; windowMs?: number; maxFailures?: number } = {},
): RequestHandler {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? 15 * 60 * 1000;
  const maxFailures = options.maxFailures ?? 10;
  const expected = createHash("sha256").update(pin ?? "").digest();
  const failures = new Map<string, { count: number; until: number }>();
  let total = { count: 0, until: now() + windowMs };

  // Expire buckets lazily, with a hard cap against memory exhaustion.
  return (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.path === "/config") return next();
    if (!pin) return next(); // Production startup separately requires APP_PIN.

    const time = now();
    if (time >= total.until) total = { count: 0, until: time + windowMs };
    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    let bucket = failures.get(key);
    if (bucket && time >= bucket.until) {
      failures.delete(key);
      bucket = undefined;
    }
    if ((bucket?.count ?? 0) >= maxFailures || total.count >= 1000) {
      const until = total.count >= 1000 ? total.until : bucket!.until;
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((until - time) / 1000))));
      res.status(429).json({ message: "Too many attempts. Please wait 15 minutes before trying again." });
      return;
    }

    const candidate = createHash("sha256").update(req.get("x-app-pin") ?? "").digest();
    if (timingSafeEqual(expected, candidate)) return next();

    if (!bucket) {
      failures.forEach((entry, id) => {
        if (time >= entry.until) failures.delete(id);
      });
      if (failures.size >= 10_000) {
        res.status(429).json({ message: "Too many attempts. Please try again later." });
        return;
      }
      bucket = { count: 0, until: time + windowMs };
      failures.set(key, bucket);
    }
    bucket.count++;
    total.count++;
    res.status(401).json({ message: "locked" });
  };
}
