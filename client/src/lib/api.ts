import type { CardSearchResponse } from "@shared/rewards";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

let currentPin = "";
// Display preference only. Never persisted; refresh/locking hides samples again.
let showSamples = false;
const modeListeners = new Set<() => void>();
export function getShowSamples() { return showSamples; }
export function subscribeSampleMode(listener: () => void) {
  modeListeners.add(listener);
  return () => { modeListeners.delete(listener); };
}
export function setShowSamples(show: boolean) {
  if (show === showSamples) return;
  showSamples = show;
  modeListeners.forEach(listener => listener());
}
export function setPin(pin: string) {
  currentPin = pin;
  if (!pin) setShowSamples(false);
}
export function getPin() {
  return currentPin;
}

export class LockedError extends Error {
  constructor() {
    super("locked");
    this.name = "LockedError";
  }
}

export async function apiJson<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-app-pin": currentPin,
      "x-show-samples": String(showSamples),
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    setPin("");
    if (typeof window !== "undefined") window.dispatchEvent(new Event("card-tracker:locked"));
    throw new LockedError();
  }
  if (res.status === 429) {
    const seconds = Number(res.headers.get("Retry-After") ?? 900);
    throw new Error(`Too many attempts. Try again in ${Math.max(1, Math.ceil(seconds / 60))} minutes.`);
  }
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = text;
    try {
      const body = JSON.parse(text);
      if (typeof body.message === "string") message = body.message;
    } catch { /* Plain text errors are also supported. */ }
    throw new Error(message);
  }
  return res.json();
}

export const api = {
  config: () => apiJson("/api/config"),
  state: (sample = showSamples, signal?: AbortSignal) => apiJson("/api/state", {
    signal, headers: { "x-show-samples": String(sample) },
  }),
  saveRewardRules: (accountId: string, selection: { rules: unknown } | { productId: string }) =>
    apiJson("/api/accounts/reward-rules", { method: "POST", body: JSON.stringify({ accountId, ...selection }) }),
  searchCardProducts: (name: string, market: "US" | "CA") =>
    apiJson<CardSearchResponse>("/api/card-products/search", { method: "POST", body: JSON.stringify({ name, market }) }),
  renameCard: (accountId: string, nickname: string) =>
    apiJson("/api/accounts/nickname", {
      method: "POST",
      body: JSON.stringify({ accountId, nickname }),
    }),
  linkToken: () => apiJson("/api/plaid/link-token", { method: "POST" }),
  exchange: (publicToken: string) =>
    apiJson("/api/plaid/exchange", {
      method: "POST",
      body: JSON.stringify({ public_token: publicToken }),
    }),
  sync: () => apiJson("/api/plaid/sync", { method: "POST" }),
  removeItem: (itemId: string) =>
    apiJson("/api/plaid/remove", {
      method: "POST",
      body: JSON.stringify({ itemId }),
    }),
  seedDemo: () => apiJson("/api/demo/seed", { method: "POST" }),
  clearReal: () => apiJson("/api/demo/clear", {
    method: "POST",
    body: JSON.stringify({ confirm: "disconnect-all" }),
  }),
};

/* ---------- Plaid Link script loader ---------- */
declare global {
  interface Window {
    Plaid?: any;
  }
}

let linkScriptPromise: Promise<void> | null = null;
export function loadPlaidLink(): Promise<void> {
  if (window.Plaid) return Promise.resolve();
  if (!linkScriptPromise) {
    linkScriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      s.async = true;
      const failed = () => {
        s.remove();
        linkScriptPromise = null;
        reject(new Error("Could not load Plaid's secure window. Check your connection and try again."));
      };
      s.onload = () => {
        if (window.Plaid?.create) resolve();
        else failed();
      };
      s.onerror = failed;
      document.head.appendChild(s);
    });
  }
  return linkScriptPromise;
}
