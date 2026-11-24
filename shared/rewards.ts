import type { Account, Transaction } from "./schema";

export const rewardCategories = ["Dining", "Groceries", "Transport", "Shopping", "Subscriptions", "Health", "Travel", "Home", "Utilities", "Services", "Insurance", "Education", "Giving", "Entertainment", "Other"] as const;
type Category = typeof rewardCategories[number];
export type RewardRules = {
  productName?: string;
  unit: string;
  base: number;
  bonuses: Partial<Record<Category, number>>;
  potential?: Partial<Record<Category, number>>;
};

export type RewardProduct = {
  id: string; name: string; aliases: string[]; currency: "USD" | "CAD";
  source: string; checked: string; terms: string; rules: RewardRules;
};

const checked = "2026-11-24";
export const rewardCatalog: RewardProduct[] = [
  { id: "chase-sapphire-preferred-us", name: "Chase Sapphire Preferred", aliases: ["Sapphire Preferred", "Chase Sapphire Preferred Card"], currency: "USD", checked,
    source: "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred",
    terms: "5× requires Chase Travel; select online groceries, streaming, gas, EV charging and vacation homes have separate rules. Travel covered by the annual hotel credit does not earn points.",
    rules: { unit: "Chase Ultimate Rewards points", base: 1, bonuses: { Dining: 3, Travel: 2 },
      potential: { Travel: 5, Groceries: 3, Subscriptions: 3, Transport: 3, Entertainment: 3 } } },
  { id: "amex-gold-us", name: "American Express Gold Card", aliases: ["Amex Gold", "American Express Gold"], currency: "USD", checked,
    source: "https://www.americanexpress.com/us/credit-cards/card/gold-card/",
    terms: "4× eligible restaurants and U.S. supermarkets have separate annual caps; travel rates depend on booking type and channel (up to 5× on eligible prepaid hotels).",
    rules: { unit: "Amex Membership Rewards points", base: 1, bonuses: {}, potential: { Dining: 4, Groceries: 4, Travel: 5 } } },
  { id: "amex-cobalt-ca", name: "American Express Cobalt Card", aliases: ["Amex Cobalt", "American Express Cobalt"], currency: "CAD", checked,
    source: "https://www.americanexpress.com/ca/en/benefits/cobalt-card/",
    terms: "Accelerated rates require eligible Canadian merchants. Caps, merchant coding and eligible Amex Travel bookings can affect the rate.",
    rules: { unit: "Amex Membership Rewards points", base: 1, bonuses: {}, potential: { Dining: 5, Groceries: 5, Subscriptions: 3, Transport: 2, Travel: 2 } } },
  { id: "amex-gold-ca", name: "American Express Gold Rewards Card", aliases: ["Amex Gold Rewards", "American Express Gold Rewards"], currency: "CAD", checked,
    source: "https://www.americanexpress.com/ca/en/benefits/gold-rewards-card/double.html",
    terms: "2× depends on eligible travel or purchases at eligible stand-alone Canadian gas stations, grocery stores and drugstores.",
    rules: { unit: "Amex Membership Rewards points", base: 1, bonuses: {}, potential: { Groceries: 2, Health: 2, Transport: 2, Travel: 2 } } },
  { id: "chase-freedom-unlimited-us", name: "Chase Freedom Unlimited", aliases: ["Freedom Unlimited", "Chase Freedom Unlimited Card"], currency: "USD", checked,
    source: "https://creditcards.chase.com/cash-back-credit-cards/freedom/unlimited",
    terms: "3% at eligible restaurants and drugstores. 5% requires eligible Chase Travel bookings. Cash back is shown at the issuer’s standard cash rate.",
    rules: { unit: "Cash back", base: 1.5, bonuses: { Dining: 3 }, potential: { Health: 3, Travel: 5 } } },
  { id: "capital-one-venture-us", name: "Capital One Venture Rewards", aliases: ["Venture Rewards", "Venture Rewards Credit Card", "Capital One Venture"], currency: "USD", checked,
    source: "https://www.capitalone.com/credit-cards/venture/",
    terms: "5× applies to eligible hotels, vacation rentals and rental cars via Capital One Travel or purchases via Capital One Entertainment.",
    rules: { unit: "Capital One miles", base: 2, bonuses: {}, potential: { Travel: 5, Entertainment: 5 } } },
];

export function findRewardProduct(id: unknown) {
  return rewardCatalog.find(p => p.id === id);
}

export function normalizeRewardName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function readRewardRules(input: unknown): RewardRules | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const { unit, base, bonuses, productName } = input as Record<string, unknown>;
  const rate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 50;
  if (typeof unit !== "string" || !unit.trim() || unit.trim().length > 40 || /[\x00-\x1f\x7f]/.test(unit) ||
    !rate(base) || !bonuses || typeof bonuses !== "object" || Array.isArray(bonuses)) return null;
  const cleaned: RewardRules["bonuses"] = {};
  for (const [key, value] of Object.entries(bonuses)) {
    if (!rewardCategories.includes(key as Category) || !rate(value)) return null;
    cleaned[key as Category] = value;
  }
  const name = productName === undefined ? undefined : readPublicCardName(productName);
  if (productName !== undefined && !name) return null;
  return { ...(name ? { productName: name } : {}), unit: unit.trim(), base, bonuses: cleaned };
}

const publicNameLetter = new RegExp("\\p{L}", "u");
const publicNameCharacters = new RegExp("^[\\p{L}\\p{M}0-9 &.'’+®™%(),/-]+$", "u");

// Only user-entered public product names can go to the search provider.
export function readPublicCardName(input: unknown) {
  if (typeof input !== "string") return null;
  const name = input.normalize("NFKC").trim().replace(/ +/g, " ");
  if (name.length < 2 || name.length > 100 || !publicNameLetter.test(name) ||
      !publicNameCharacters.test(name) || name.replace(/\D/g, "").length >= 12 ||
      /(?:\bwww\.|\.(?:com|net|org|ca)\b|\/\/)/i.test(name)) return null;
  return name;
}

export type CardSearchSource = { title: string; url: string };
export type CardSearchMatch = { name: string; rules: RewardRules; source: CardSearchSource };
export type CardSearchResponse = { enabled: boolean; sources: CardSearchSource[]; matches: CardSearchMatch[] };

export const demoRewards: Readonly<Record<string, RewardRules>> = {
  "demo-harbor": { unit: "Sample points", base: 1, bonuses: { Dining: 3, Groceries: 3 } },
  "demo-summit": { unit: "Sample points", base: 1, bonuses: { Travel: 5, Dining: 2 } },
  "demo-juniper": { unit: "Cash back", base: 1.5, bonuses: { Shopping: 2 } },
};

export function rewardEstimate(card: Account, amountCents: number, category: string, currency: string) {
  const rules = card.rewardRules;
  if (card.type !== "credit" || !rules || currency !== card.currency ||
      !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
      !rewardCategories.includes(category as Category)) return null;
  const rate = rules.bonuses[category as Category] ?? rules.base;
  const potential = Math.max(rate, rules.potential?.[category as Category] ?? rate);
  return { card, rate, unit: rules.unit, value: amountCents * rate / 100, upper: amountCents * potential / 100 };
}

export function purchaseEligible(t: Transaction) {
  return t.amountCents > 0 && !t.pending && t.category !== "Other" && rewardCategories.includes(t.category as Category);
}

export function transactionEstimate(card: Account, t: Transaction, billingCurrency: string) {
  if (!purchaseEligible(t) || (t.rewardContext && t.rewardContext.currency !== billingCurrency)) return null;
  const estimate = rewardEstimate(card, t.amountCents, t.category, billingCurrency);
  if (!estimate || t.itemId === "demo" || t.category !== "Dining" ||
      /^FOOD_AND_DRINK_(FAST_FOOD|RESTAURANT|COFFEE)$/.test(t.rewardContext?.detailedCategory ?? "")) return estimate;
  // Older records used one broad food category. Do not assign a restaurant-only
  // bonus as definite when the transaction might have been grocery or retail.
  const groceries = rewardEstimate(card, t.amountCents, "Groceries", billingCurrency);
  return { ...estimate,
    value: Math.min(estimate.value, groceries?.value ?? estimate.value, t.amountCents * card.rewardRules!.base / 100),
    upper: Math.max(estimate.upper, groceries?.upper ?? estimate.upper),
  };
}

export function betterTransactionAlternative(earned: ReturnType<typeof transactionEstimate>, cards: Account[], t: Transaction) {
  if (!earned) return null;
  const unit = earned.unit.toLowerCase();
  const precision = unit === "cash back" ? 1 : 100;
  const threshold = Math.round(earned.upper * precision);
  let best: ReturnType<typeof transactionEstimate> = null;
  for (const card of cards) {
    if (card.id === earned.card.id) continue;
    const row = transactionEstimate(card, t, earned.card.currency);
    if (!row || row.unit.toLowerCase() !== unit || Math.round(row.value * precision) <= threshold) continue;
    if (!best || row.value > best.value || (row.value === best.value && row.upper > best.upper)) best = row;
  }
  return best;
}

export function rewardGroups(cards: Account[], cents: number, category: string, currency: string) {
  const groups = new Map<string, NonNullable<ReturnType<typeof rewardEstimate>>[]>();
  for (const card of cards) {
    const result = rewardEstimate(card, cents, category, currency);
    if (!result) continue;
    const key = result.unit.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(result);
  }
  return Array.from(groups.values(), rows => rows.sort((a, b) => b.value - a.value || b.upper - a.upper));
}
