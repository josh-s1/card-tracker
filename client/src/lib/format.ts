import type { Account, Transaction, SafeItem } from "@shared/schema";

/* ---------- Money & dates ---------- */

export function money(cents: number, currency = "USD"): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency,
  });
}

export function money0(cents: number, currency = "USD"): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
}

export function todayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parse(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function daysUntil(s: string): number {
  return Math.round((parse(s) - parse(todayISO())) / 86400000);
}

export function fmtDate(s: string): string {
  return new Date(parse(s)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function dayLabel(s: string): string {
  const n = daysUntil(s);
  return n === 0 ? "Today" : n === -1 ? "Yesterday" : fmtDate(s);
}

export function dueText(s: string): string {
  const n = daysUntil(s);
  if (n < 0) return `was due ${-n} day${-n === 1 ? "" : "s"} ago`;
  return n === 0 ? "due today" : n === 1 ? "due tomorrow" : `due in ${n} days`;
}

/* ---------- Categories ---------- */

export const CATEGORY_COLORS: Record<string, string> = {
  Dining: "#C0763A",
  Groceries: "#3F7D5A",
  Transport: "#3E6FA3",
  Shopping: "#8A5FA8",
  Subscriptions: "#B2476B",
  Health: "#2E8C96",
  Travel: "#6B6FB5",
  Home: "#6B8E5A",
  Utilities: "#7A6A3F",
  Services: "#8A7B5C",
  Insurance: "#4A6B8A",
  Education: "#5A4A8A",
  Giving: "#8A5A5A",
  Entertainment: "#A85A8A",
  Payment: "#8A949C",
  Fees: "#9C8A6A",
  Taxes: "#9C6A8A",
  Income: "#2E7D4F",
  Other: "#7A828A",
};

export function catColor(c: string): string {
  return CATEGORY_COLORS[c] ?? CATEGORY_COLORS.Other;
}

/* ---------- App state helpers ---------- */

export interface AppState {
  sampleDataAvailable?: boolean;
  items: SafeItem[];
  accounts: Account[];
  transactions: Transaction[];
}

export interface Card extends Account {
  isCredit: boolean;
}

export function cardsOf(state: AppState): Account[] {
  return state.accounts;
}

/** Credit cards only (the "owed" universe). */
export function creditCards(state: AppState): Account[] {
  return state.accounts.filter((a) => a.type === "credit");
}

export function cardById(state: AppState, id: string): Account | undefined {
  return state.accounts.find((a) => a.id === id);
}

export function txnsOfCard(state: AppState, cardId: string): Transaction[] {
  return state.transactions.filter((t) => t.accountId === cardId);
}

export function txnsFor(state: AppState, cardId: "all" | string): Transaction[] {
  return cardId === "all"
    ? state.transactions
    : state.transactions.filter((t) => t.accountId === cardId);
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Last N months, newest first, ending with the current month. */
export function recentMonths(n: number): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: monthKey(d),
      label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
  }
  return out;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export function displayMerchant(t: Transaction): string {
  return t.merchantName || t.name;
}
