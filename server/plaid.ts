/**
 * Minimal Plaid REST client — no SDK, just fetch.
 * Credentials come from env vars and never leave the server.
 */

const PLAID_HOST =
  process.env.PLAID_ENV === "sandbox"
    ? "https://sandbox.plaid.com"
    : "https://production.plaid.com";

export function plaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function plaidEnv(): string {
  return process.env.PLAID_ENV === "sandbox" ? "sandbox" : "production";
}

export class PlaidError extends Error {
  status: number;
  plaidCode?: string;
  constructor(message: string, status = 502, plaidCode?: string) {
    super(message);
    this.status = status;
    this.plaidCode = plaidCode;
  }
}

async function plaidFetch(endpoint: string, body: Record<string, unknown>) {
  if (!plaidConfigured()) {
    throw new PlaidError("Plaid is not configured on this server.", 400, "NOT_CONFIGURED");
  }
  const res = await fetch(`${PLAID_HOST}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json: any = await res.json().catch(() => null);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new PlaidError("The bank-data service returned an invalid response. Please retry.", 502, "INVALID_RESPONSE");
  }
  if (!res.ok) {
    throw new PlaidError(
      "The bank-data request did not complete. Please retry or reconnect the bank if required.",
      502,
      json?.error_code,
    );
  }
  return json;
}

export function createLinkToken(userName: string) {
  return plaidFetch("/link/token/create", {
    user: { client_user_id: userName },
    client_name: "Card Tracker",
    products: ["transactions", "liabilities"],
    country_codes: ["US", "CA"],
    language: "en",
  });
}

export function exchangePublicToken(publicToken: string) {
  return plaidFetch("/item/public_token/exchange", {
    public_token: publicToken,
  });
}

export function getItem(accessToken: string) {
  return plaidFetch("/item/get", { access_token: accessToken });
}

export function getInstitutionById(institutionId: string) {
  return plaidFetch("/institutions/get_by_id", {
    institution_id: institutionId,
    country_codes: ["US", "CA"],
    options: { include_optional_metadata: true },
  });
}

export function getAccountsBalances(accessToken: string) {
  return plaidFetch("/accounts/balance/get", { access_token: accessToken });
}

export function getLiabilities(accessToken: string) {
  return plaidFetch("/liabilities/get", { access_token: accessToken });
}

export function transactionsSync(accessToken: string, cursor?: string | null) {
  return plaidFetch("/transactions/sync", {
    access_token: accessToken,
    cursor: cursor || undefined,
    count: 500,
  });
}

export function removeItem(accessToken: string) {
  return plaidFetch("/item/remove", { access_token: accessToken });
}

/**
 * Map Plaid personal_finance_category.primary to a compact set of
 * display categories with colors.
 */
const CATEGORY_MAP: Record<string, string> = {
  FOOD_AND_DRINK: "Dining",
  GROCERIES: "Groceries",
  TRANSPORTATION: "Transport",
  RETAIL_AND_GOODS_SERVICES: "Shopping",
  GENERAL_SERVICES: "Services",
  PERSONAL_SERVICES: "Services",
  HEALTH_AND_WELLNESS: "Health",
  HOME_IMPROVEMENT: "Home",
  TRAVEL: "Travel",
  RENT_AND_UTILITIES: "Utilities",
  DIGITAL_PURCHASES: "Subscriptions",
  LOAN_PAYMENTS: "Payment",
  TRANSFER: "Payment",
  PAYMENT: "Payment",
  BANK_FEES: "Fees",
  FEES: "Fees",
  TAX: "Taxes",
  GOVERNMENT_AND_NON_PROFIT: "Services",
  INSURANCE: "Insurance",
  EDUCATION: "Education",
  CHARITABLE_GIVING: "Giving",
  ENTERTAINMENT: "Entertainment",
  GENERAL_PAYMENTS: "Payment",
  INCOME: "Income",
};

export function mapCategory(
  personalFinancePrimary: string | null | undefined,
  fallbackType?: string | null | undefined,
): string {
  if (personalFinancePrimary && CATEGORY_MAP[personalFinancePrimary]) {
    return CATEGORY_MAP[personalFinancePrimary];
  }
  if (fallbackType === "payment" || fallbackType === "payroll") return "Payment";
  if (fallbackType === "deposit") return "Income";
  return "Other";
}

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
