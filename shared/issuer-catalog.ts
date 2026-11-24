import type { RewardCatalogEntry, RewardRules } from "./rewards";

export const issuerDirectories = {
  "chase-personal": { label: "Chase personal", url: "https://creditcards.chase.com/all-credit-cards" },
  "chase-business": { label: "Chase business", url: "https://creditcards.chase.com/business-credit-cards" },
  "amex-personal": { label: "Amex personal", url: "https://www.americanexpress.com/us/credit-cards/" },
  "amex-business": { label: "Amex business", url: "https://www.americanexpress.com/us/credit-cards/business/business-credit-cards/" },
} as const;

export type IssuerDirectoryId = keyof typeof issuerDirectories;
export const issuerCatalogChecked = "2026-11-24";
export const hiltonSource = "https://www.americanexpress.com/us/credit-cards/card/hilton-honors/";
export const sapphireSource = "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred";

const cash = (base: number, bonuses: RewardRules["bonuses"] = {}, potential: RewardRules["potential"] = {}): RewardRules =>
  ({ unit: "Cash back", base, bonuses, potential });
const points = (unit: string, base: number, bonuses: RewardRules["bonuses"] = {}, potential: RewardRules["potential"] = {}): RewardRules =>
  ({ unit, base, bonuses, potential });
const amex = (base: number, bonuses: RewardRules["bonuses"], potential: RewardRules["potential"]) =>
  points("Amex Membership Rewards points", base, bonuses, potential);
const hilton = (base: number, potential: RewardRules["potential"]) => points("Hilton Honors points", base, {}, potential);
const avios = points("Avios", 1, {}, { Travel: 3 });
const ultimate = (base: number, bonuses: RewardRules["bonuses"] = {}, potential: RewardRules["potential"] = {}) =>
  points("Chase Ultimate Rewards points", base, bonuses, potential);
const inkTerms = "https://creditcards.chase.com/a1/business-compare-cards/0926";
const amexAgreements = "https://www.americanexpress.com/en-us/company/legal/cardmember-agreements/";

type Row = [id: string, name: string, aliases?: string[], rules?: RewardRules, terms?: string, source?: string];
const groups: Record<IssuerDirectoryId, Row[]> = {
  "chase-personal": [
    ["chase-sapphire-reserve-us", "Chase Sapphire Reserve", [], ultimate(1, { Dining: 3 }, { Travel: 8 }), "8× on qualifying Chase Travel and 4× on qualifying flights and hotels booked direct. Purchases covered by eligible travel credits do not earn.", "https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve"],
    ["chase-freedom-flex-us", "Chase Freedom Flex", [], cash(1, { Dining: 3 }, { Health: 3, Travel: 5 }), "5% rotating categories require activation and a separate quarterly cap. Rotating categories are not estimated here."],
    ["chase-freedom-rise-us", "Chase Freedom Rise", [], cash(1.5), "1.5% cash back on purchases."],
    ["chase-slate-us", "Chase Slate", ["Slate Credit Card"]],
    ["chase-united-gateway-us", "United Gateway Card"],
    ["chase-united-explorer-us", "United Explorer Card"],
    ["chase-united-quest-us", "United Quest Card"],
    ["chase-united-club-us", "United Club Card"],
    ["chase-southwest-plus-us", "Southwest Rapid Rewards Plus Credit Card"],
    ["chase-southwest-premier-us", "Southwest Rapid Rewards Premier Credit Card"],
    ["chase-southwest-priority-us", "Southwest Rapid Rewards Priority Credit Card"],
    ["chase-marriott-bold-us", "Marriott Bonvoy Bold Credit Card"],
    ["chase-marriott-boundless-us", "Marriott Bonvoy Boundless Credit Card"],
    ["chase-marriott-bountiful-us", "Marriott Bonvoy Bountiful Credit Card"],
    ["chase-ihg-traveler-us", "IHG One Rewards Traveler Credit Card", ["IHG One Rewards Credit Card"]],
    ["chase-ihg-premier-us", "IHG One Rewards Premier Credit Card"],
    ["chase-ihg-premier-select-us", "IHG One Rewards Premier Select Credit Card"],
    ["chase-hyatt-us", "World of Hyatt Credit Card"],
    ["chase-disney-inspire-us", "Disney Inspire Visa Card"],
    ["chase-disney-premier-us", "Disney Premier Visa Card"],
    ["chase-disney-us", "Disney Visa Card"],
    ["chase-prime-visa-us", "Prime Visa", ["Amazon Prime Rewards Visa"], cash(1, { Dining: 2 }, { Transport: 2, Shopping: 5, Groceries: 5, Travel: 5 }), "5% requires an eligible Prime membership and specific merchants or Chase Travel. Not all transport qualifies for 2%."],
    ["chase-amazon-visa-us", "Amazon Visa", [], cash(1, { Dining: 2 }, { Transport: 2, Shopping: 3, Groceries: 3, Travel: 3 }), "3% is limited to specific merchants or Chase Travel; not all transport qualifies for 2%."],
    ["chase-aeroplan-us", "Air Canada Aeroplan Card", ["Chase Aeroplan Card"]],
    ["chase-ba-visa-us", "British Airways Visa Signature Credit Card", [], avios, "The travel bonus depends on the airline or booking directly with a hotel."],
    ["chase-aer-lingus-us", "Aer Lingus Visa Signature Credit Card", [], avios, "The travel bonus depends on the airline or booking directly with a hotel."],
    ["chase-iberia-us", "Iberia Visa Signature Credit Card", [], avios, "The travel bonus depends on the airline or booking directly with a hotel."],
    ["chase-doordash-us", "DoorDash Rewards Mastercard", [], cash(1, { Groceries: 2 }, { Dining: 4 }), "Rates depend on ordering directly from a restaurant versus through DoorDash or Caviar."],
    ["chase-instacart-us", "Instacart Mastercard"],
  ],
  "chase-business": [
    ["chase-ink-unlimited-us", "Ink Business Unlimited Credit Card", [], cash(1.5), "1.5% cash back on purchases."],
    ["chase-ink-cash-us", "Ink Business Cash Credit Card", [], cash(1, {}, { Shopping: 5, Subscriptions: 5, Utilities: 5, Dining: 2, Transport: 2 }), "Office supplies and communications services share one spend cap; dining and gas share a separate cap. Cap usage is not tracked.", inkTerms],
    ["chase-ink-preferred-us", "Ink Business Preferred Credit Card", [], ultimate(1, {}, { Travel: 3, Services: 3, Subscriptions: 3, Utilities: 3 }), "Travel and eligible shipping, advertising and communications purchases have a combined account-anniversary-year cap.", inkTerms],
    ["chase-ink-premier-us", "Ink Business Premier Credit Card", [], { ...cash(2, {}, { Travel: 5 }), largePurchaseBoost: { thresholdCents: 500_000, rate: 2.5 } }, "2.5% on eligible purchases of at least $5,000. 5% requires an eligible Chase Travel purchase.", inkTerms],
    ["chase-sapphire-reserve-business-us", "Sapphire Reserve for Business Credit Card", ["Chase Business Sapphire Reserve"], ultimate(1, {}, { Travel: 8, Services: 3 }), "Up to 8× on eligible travel; some travel credits don’t earn. Select advertising earns up to 3× subject to an annual cap.", "https://creditcards.chase.com/business-credit-cards/sapphire/reserve"],
    ["chase-united-business-us", "United Business Card"],
    ["chase-united-club-business-us", "United Club Business Card"],
    ["chase-southwest-performance-business-us", "Southwest Rapid Rewards Performance Business Credit Card"],
    ["chase-southwest-premier-business-us", "Southwest Rapid Rewards Premier Business Credit Card"],
    ["chase-ihg-business-us", "IHG One Rewards Business Credit Card"],
    ["chase-hyatt-business-us", "World of Hyatt Business Credit Card"],
  ],
  "amex-personal": [
    ["amex-platinum-us", "American Express Platinum Card", ["Platinum Card"]],
    ["amex-green-us", "American Express Green Card", ["Amex Green", "American Express Classic Green Card"], amex(1, { Dining: 3, Travel: 3 }, { Transport: 3 }), "3× on eligible restaurant, travel and transit purchases. The tracker’s broad Transport category includes things other than eligible transit.", "https://global.americanexpress.com/card-benefits/detail/earn-membership-rewards-points/amex-green"],
    ["amex-blue-cash-preferred-us", "Blue Cash Preferred Card", ["Amex BCP"]],
    ["amex-blue-cash-everyday-us", "Blue Cash Everyday Card", ["Amex BCE"], cash(1, {}, { Groceries: 3, Transport: 3, Shopping: 3 }), "Eligible U.S. supermarkets, U.S. gas stations and U.S. online retail earn 3% up to separate annual caps; then 1%."],
    ["amex-delta-blue-us", "Delta SkyMiles Blue American Express Card"],
    ["amex-delta-gold-us", "Delta SkyMiles Gold American Express Card"],
    ["amex-delta-platinum-us", "Delta SkyMiles Platinum American Express Card"],
    ["amex-delta-reserve-us", "Delta SkyMiles Reserve American Express Card"],
    ["amex-marriott-bevy-us", "Marriott Bonvoy Bevy American Express Card", [], points("Marriott Bonvoy points", 2, {}, { Travel: 6, Dining: 4, Groceries: 4 }), "6× only at participating hotels. Eligible restaurant and U.S. supermarket purchases earn 4× up to a combined calendar-year cap; then 2×."],
    ["amex-marriott-brilliant-us", "Marriott Bonvoy Brilliant American Express Card"],
    ["amex-hilton-honors-us", "Hilton Honors American Express Card", ["Hilton Honors Amex", "Amex Hilton Honors", "Hilton Honors no annual fee", "Free Hilton Amex"], hilton(3, { Dining: 5, Groceries: 5, Transport: 5, Travel: 7 }), "No annual fee. Bonus rates depend on eligible Hilton stays charged directly or eligible U.S. restaurants, supermarkets and gas stations.", hiltonSource],
    ["amex-hilton-surpass-us", "Hilton Honors American Express Surpass Card", ["Hilton Surpass"], hilton(3, { Dining: 6, Groceries: 6, Transport: 6, Shopping: 4, Travel: 12 }), "Bonuses require direct Hilton purchases, eligible U.S. restaurants, supermarkets, gas stations or U.S. online retail.", "https://global.americanexpress.com/card-benefits/detail/hilton-honors-bonus-points-hs/hilton-surpass"],
    ["amex-hilton-aspire-us", "Hilton Honors American Express Aspire Card", ["Hilton Aspire"], hilton(3, { Dining: 7, Travel: 14 }), "14× on eligible Hilton purchases. 7× on eligible flights, rentals and U.S. restaurants.", "https://www.americanexpress.com/us/credit-cards/card/hilton-honors-aspire/"],
    ["amex-goldman-platinum-us", "Goldman Sachs Platinum Card", [], undefined, undefined, amexAgreements],
    ["amex-morgan-platinum-us", "Morgan Stanley Platinum Card", [], undefined, undefined, amexAgreements],
    ["amex-schwab-platinum-us", "Charles Schwab Platinum Card", [], undefined, undefined, amexAgreements],
    ["amex-centurion-us", "Centurion Card", ["Amex Black Card"], undefined, undefined, amexAgreements],
    ["amex-cash-magnet-us", "American Express Cash Magnet Card", [], undefined, undefined, amexAgreements],
    ["amex-everyday-us", "Amex EveryDay Card", [], undefined, undefined, amexAgreements],
    ["amex-everyday-preferred-us", "Amex EveryDay Preferred Card", [], undefined, undefined, amexAgreements],
    ["amex-marriott-us", "Marriott Bonvoy American Express Card", [], undefined, undefined, amexAgreements],
    ["amex-morgan-blue-cash-us", "Morgan Stanley Blue Cash Preferred American Express Card", [], undefined, undefined, amexAgreements],
    ["amex-schwab-investor-us", "Charles Schwab Investor Credit Card", [], undefined, undefined, amexAgreements],
    ["amex-optima-us", "Optima Card", [], undefined, undefined, amexAgreements],
  ],
  "amex-business": [
    ["amex-business-platinum-us", "Business Platinum Card", ["Amex Business Platinum"], amex(1, {}, { Travel: 5, Home: 2, Shopping: 2, Services: 2, Subscriptions: 2 }), "5× for eligible Amex Travel bookings; 2× on eligible U.S. merchants and large purchases, up to a calendar-year cap. Large-purchase rates across other categories aren’t modeled."],
    ["amex-business-gold-us", "Business Gold Card", ["Amex Business Gold"]],
    ["amex-graphite-us", "Graphite Business Cash Unlimited Card", ["Amex Graphite"], cash(2, {}, { Travel: 5 }), "2% on eligible purchases; 5% on eligible flights and prepaid hotels booked through Amex Travel Online."],
    ["amex-blue-business-cash-us", "Blue Business Cash Card", ["Amex Blue Business Cash"], { ...cash(1), fallbackPotential: 2 }, "2% for the first $50,000 in eligible purchases in a calendar year, then 1%. Cap usage is not tracked."],
    ["amex-blue-business-plus-us", "Blue Business Plus Credit Card", ["Amex BBP"], { ...amex(1, {}, { Travel: 2 }), fallbackPotential: 2 }, "2× on the first $50,000 in eligible purchases per calendar year, then 1×; eligible Amex Travel purchases earn 2× separately. Cap usage is not tracked."],
    ["amex-business-green-us", "Business Green Rewards Card", ["Amex Business Green"], amex(1, {}, { Travel: 2 }), "2× on eligible flights and prepaid hotels booked through Amex Travel."],
    ["amex-delta-gold-business-us", "Delta SkyMiles Gold Business Card", [], points("Delta SkyMiles", 1, { Dining: 2 }, { Travel: 2, Services: 2 }), "Qualifying Delta purchases and restaurants can earn 2×; U.S. shipping and select U.S. advertising each have annual caps."],
    ["amex-delta-platinum-business-us", "Delta SkyMiles Platinum Business Card", [], points("Delta SkyMiles", 1, {}, { Travel: 3, Transport: 1.5, Services: 1.5 }), "3× on Delta or direct hotel purchases; select 1.5× purchases including eligible transit, U.S. shipping and large purchases have a separate cap."],
    ["amex-delta-reserve-business-us", "Delta SkyMiles Reserve Business Card", [], points("Delta SkyMiles", 1, {}, { Travel: 3, Transport: 1.5, Shopping: 1.5, Services: 1.5 }), "3× on Delta and 1.5× on select categories. Overall spend thresholds are not tracked."],
    ["amex-hilton-business-us", "Hilton Honors Business Card", [], { ...hilton(3, { Travel: 12 }), fallbackPotential: 5 }, "12× at eligible Hilton properties; otherwise 5× on the first $100,000 each calendar year, then 3×. Cap usage is not tracked."],
    ["amex-marriott-business-us", "Marriott Bonvoy Business Card"],
  ],
};

export const extraIssuerProducts: RewardCatalogEntry[] = Object.entries(groups).flatMap(([key, rows]) => {
  const directory = key as IssuerDirectoryId;
  return rows.map(([id, name, aliases = [], rules, terms, source]) => ({
    id, name, aliases, currency: "USD", rules, directory, checked: issuerCatalogChecked,
    source: source ?? issuerDirectories[directory].url,
    terms: terms ?? "Open the issuer’s terms. Built-in rates are not configured for this product yet.",
  }));
});
