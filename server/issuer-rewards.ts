import { hiltonSource, issuerDirectories, sapphireSource } from "@shared/issuer-catalog";
import { normalizeRewardName, rewardCatalog, type IssuerRewardCheck, type IssuerRewardSource, type RewardRules } from "@shared/rewards";

export const issuerRewardSources: IssuerRewardSource[] = [
  { id: "chase-sapphire-preferred-us", label: "Chase Sapphire Preferred", url: sapphireSource, kind: "rates" },
  { id: "amex-hilton-honors-us", label: "Hilton Honors American Express", url: hiltonSource, kind: "rates" },
  ...Object.entries(issuerDirectories).map(([id, info]) => ({ id, ...info, kind: "directory" as const })),
];

export function issuerPageText(html: string) {
  return html.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?(?:strong|b|em|i|span|a|u|sup)\b[^>]*>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(nbsp|#160|#xA0);/gi, " ")
    .replace(/&(reg|trade|#174|#8482);|[®™℠]/gi, "")
    .replace(/&(rsquo|apos|#39|#8217);|’/gi, "'")
    .replace(/&(?:amp);/gi, "&")
    .replace(/\s+/g, " ").trim();
}

function oneRate(text: string, pattern: RegExp) {
  const rates = new Set(Array.from(text.matchAll(pattern), match => Number(match[1])));
  if (rates.size !== 1) return null;
  const rate = rates.values().next().value;
  return typeof rate === "number" && rate > 0 && rate <= 25 ? rate : null;
}

export function readIssuerRates(id: string, text: string): RewardRules | null {
  if (id === "amex-hilton-honors-us") {
    const stem = "Earn (\\d+)X Hilton Honors Bonus Points";
    const base = oneRate(text, new RegExp(`${stem} for all other eligible purchases on your Card\\.`, "gi"));
    const hotel = oneRate(text, new RegExp(`${stem} for each dollar of eligible purchases charged on your Card directly with a hotel or resort within the Hilton portfolio\\.`, "gi"));
    const dining = oneRate(text, new RegExp(`${stem} for each dollar of eligible purchases on your Card at U\\.S\\. restaurants\\.`, "gi"));
    const groceries = oneRate(text, new RegExp(`${stem} for each dollar of eligible purchases on your Card at U\\.S\\. supermarkets\\.`, "gi"));
    const gas = oneRate(text, new RegExp(`${stem} for each dollar of eligible purchases on your Card at U\\.S\\. gas stations\\.`, "gi"));
    if (base === null || hotel === null || dining === null || groceries === null || gas === null ||
        [hotel, dining, groceries, gas].some(value => value < base)) return null;
    return { unit: "Hilton Honors points", base, bonuses: {}, potential: { Travel: hotel, Dining: dining, Groceries: groceries, Transport: gas } };
  }
  if (id === "chase-sapphire-preferred-us") {
    const stem = "You'll earn (\\d+) points? for each \\$1 spent on";
    const base = oneRate(text, new RegExp(`${stem} all other purchases\\.`, "gi"));
    const travel = oneRate(text, new RegExp(`${stem} purchases made in the travel category \\(excluding purchases made through Chase Travel that qualify for \\d+ points as described\\)\\.`, "gi"));
    const portal = oneRate(text, new RegExp(`${stem} purchases made using your card through Chase Travel\\.`, "gi"));
    const category = oneRate(text, new RegExp(`${stem} purchases in the following rewards categories: vacation homes at top brands[^;]{0,140}; gas stations; electric vehicle charging; dining at restaurants including takeout and eligible delivery services; top streaming services[^;]{0,140}; online grocery \\(excluding Target\\s*, Walmart\\s* and wholesale clubs\\)\\.`, "gi"));
    if (base === null || travel === null || portal === null || category === null || travel < base || portal < travel || category < base) return null;
    return { unit: "Chase Ultimate Rewards points", base, bonuses: { Travel: travel, Dining: category },
      potential: { Travel: Math.max(portal, category), Groceries: category, Subscriptions: category, Transport: category } };
  }
  return null;
}

async function fetchIssuerPage(url: string) {
  const response = await fetch(url, {
    method: "GET", headers: { Accept: "text/html" }, redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html") || !response.body) {
    throw new Error("Issuer terms unavailable");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error("Issuer response exceeds limit");
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
    return issuerPageText(parts.join(""));
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function checkIssuerRewards(previous: IssuerRewardCheck[]) {
  const byId = new Map(previous.map(check => [check.id, check]));
  const result: IssuerRewardCheck[] = [];
  // At most two outbound calls at once; only fixed public issuer URLs.
  for (let at = 0; at < issuerRewardSources.length; at += 2) {
    result.push(...await Promise.all(issuerRewardSources.slice(at, at + 2).map(async (source): Promise<IssuerRewardCheck> => {
      const old = byId.get(source.id);
      const state = { id: source.id, checkedAt: new Date(Date.now()).toISOString(), rates: old?.rates, ratesAt: old?.ratesAt };
      try {
        const text = await fetchIssuerPage(source.url);
        if (source.kind === "rates") {
          const rates = readIssuerRates(source.id, text);
          return rates ? { ...state, rates, ratesAt: state.checkedAt, status: "rates-refreshed" }
            : { ...state, status: "needs-review" };
        }
        const listing = normalizeRewardName(text);
        const found = rewardCatalog.filter(p => p.directory === source.id &&
          [p.name, ...p.aliases].some(name => listing.includes(normalizeRewardName(name))));
        return { ...state, status: found.length >= 3 ? "listing-checked" : "needs-review" };
      } catch {
        return { ...state, status: "unavailable" };
      }
    })));
  }
  return result;
}
