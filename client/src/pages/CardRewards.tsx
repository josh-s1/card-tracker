import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cardName, estimateLabel } from "@/lib/format";
import type { Account } from "@shared/schema";
import {
  rewardCategories, rewardCatalog, findRewardProduct, normalizeRewardName, readPublicCardName, rewardGroups,
  type CardSearchMatch, type RewardRules,
} from "@shared/rewards";

export function CardRecommendation({ cards, sample }: { cards: Account[]; sample: boolean }) {
  const [amount, setAmount] = useState("100");
  const [category, setCategory] = useState("Dining");
  const [selectedCurrency, setCurrency] = useState("");
  const currencies = Array.from(new Set(cards.map(c => c.currency)));
  const currency = currencies.includes(selectedCurrency) ? selectedCurrency : (currencies[0] ?? "USD");
  const usable = /^\d{1,8}(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
  const groups = usable ? rewardGroups(cards, Math.round(Number(amount) * 100), category, currency) : [];
  const unconfigured = cards.filter(c => c.currency === currency && !c.rewardRules);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-white p-4">
        <label className="col-span-2 space-y-1 text-sm font-medium">Purchase category
          <select value={category} onChange={e => setCategory(e.target.value)} className="block w-full rounded-md border bg-white p-2 text-sm">
            {rewardCategories.map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">Amount
          <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
        </label>
        <label className="space-y-1 text-sm font-medium">Billing currency
          <select value={currency} onChange={e => setCurrency(e.target.value)} className="block min-h-10 w-full rounded-md border bg-white px-2 text-sm">
            {(currencies.length ? currencies : ["USD"]).map(c => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <p className="text-xs leading-relaxed text-[#68757F]">
        Estimates compare cards billed in the selected currency. Cards are ranked within each reward program by the lower estimate; different points, miles and cash back are not ranked against each other. Ranges depend on issuer eligibility, caps and booking terms.
      </p>
      {!usable && <p role="status" className="text-sm">Enter a positive amount with up to two decimal places.</p>}
      {usable && !groups.length && <p className="rounded-xl bg-white p-4 text-sm">No configured rewards for this currency yet.</p>}
      {groups.map(group => (
        <section key={group[0].unit} className="rounded-xl bg-white p-4">
          <h2 className="text-sm font-semibold">{group[0].unit}</h2>
          <ul className="mt-2 space-y-2">
            {group.map((row, i) => <li key={row.card.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-t pt-2 text-sm">
              <span className="min-w-0 break-words">{cardName(row.card)}{i === 0 && group.length > 1 && row.value > group[1].value ? " · Best conservative estimate" : ""}</span>
              <span className="font-semibold tabular-nums">{estimateLabel(row, currency)}</span>
            </li>)}
          </ul>
        </section>
      ))}
      {!!unconfigured.length && <p className="text-xs text-[#68757F]">
        {unconfigured.length} card{unconfigured.length === 1 ? "" : "s"} in {currency} still need rewards set up.{" "}
        {!sample && <Link href="/settings" className="font-semibold text-[#1F3A5F]">Select card products in Settings</Link>}
      </p>}
    </div>
  );
}

export const rewardProductMutationKey = ["card-reward-product"] as const;

export function RewardProductEditor({ card, pin, disabled }: { card: Account; pin: string; disabled: boolean }) {
  const client = useQueryClient();
  const selected = findRewardProduct(card.rewardProductId);
  const [search, setSearch] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const [draftMatch, setDraftMatch] = useState<CardSearchMatch | null>(null);
  const [notice, setNotice] = useState("");
  const [custom, setCustom] = useState(false);
  const startingCustom = !selected ? card.rewardRules : undefined;
  const [unit, setUnit] = useState(startingCustom?.unit ?? "");
  const [base, setBase] = useState(String(startingCustom?.base ?? "1"));
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(startingCustom?.bonuses ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const mutation = useMutation({
    mutationKey: rewardProductMutationKey,
    mutationFn: (selection: { productId: string } | { rules: RewardRules | null }) => api.saveRewardRules(card.id, selection),
    onMutate: () => setNotice(""),
    onSuccess: async (_result, selection) => {
      await client.invalidateQueries({ queryKey: ["state", pin, false] });
      if ("productId" in selection || !selection.rules) {
        setDraftMatch(null);
        setCustom(false);
        setUnit("");
        setBase("1");
        setRates({});
      }
      setNotice("Reward settings saved.");
    },
  });
  const market = card.currency === "CAD" ? "CA" : "US";
  const marketLabel = market === "CA" ? "Canada" : "U.S.";
  const lookup = useMutation({ mutationFn: (name: string) => api.searchCardProducts(name, market) });
  const catalog = rewardCatalog.filter(p => p.currency === card.currency);
  const query = lookup.variables;
  const normalizedQuery = query ? normalizeRewardName(query) : "";
  const choices = normalizedQuery ? catalog.filter(p => {
    const hay = normalizeRewardName([p.name, ...p.aliases].join(" "));
    return normalizedQuery.split(" ").every(word => hay.includes(word));
  }) : [];
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const name = readPublicCardName(search);
    if (!name) {
      setSearchNotice("Enter the public card product name, not a card number or personal information.");
      return;
    }
    setSearchNotice("");
    if (!lookup.isPending && !disabled) lookup.mutate(name);
  };
  const fillRates = (match: CardSearchMatch) => {
    setNotice("");
    setDraftMatch(match);
    setUnit(match.rules.unit);
    setBase(String(match.rules.base));
    setRates(Object.fromEntries(Object.entries(match.rules.bonuses).map(([k, v]) => [k, String(v)])));
    setCustom(true);
  };
  const submitCustom = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || mutation.isPending) return;
    const bonuses = Object.fromEntries(Object.entries(rates)
      .filter(([, value]) => value.trim() !== "").map(([category, value]) => [category, Number(value)]));
    const productName = draftMatch?.name ?? card.rewardRules?.productName;
    mutation.mutate({ rules: { ...(productName ? { productName } : {}), unit, base: Number(base), bonuses } });
  };

  return (
    <details className="mt-1 rounded-lg bg-[#F2F4F6] p-2.5">
      <summary className="cursor-pointer break-words text-sm font-semibold text-[#1F3A5F]" data-testid={`select-card-product-${card.id}`}>
        {selected || card.rewardRules
          ? `Change card product · ${selected?.name ?? card.rewardRules?.productName ?? "Custom rates"}`
          : "Select card product"}
      </summary>
      <p className="mt-2 break-words text-xs text-[#68757F]">Plaid name: {card.officialName || card.name} · {card.currency}</p>
      {selected && <p className="mt-2 text-xs leading-relaxed text-[#68757F]">
        {selected.terms} <a className="font-semibold text-[#1F3A5F] underline" href={selected.source} target="_blank" rel="noreferrer">Issuer terms</a> · Checked {selected.checked}
      </p>}
      <form onSubmit={submitSearch} className="mt-3">
        <label className="block space-y-1 text-sm">Search card products on the web ({marketLabel})
          <Input value={search} maxLength={100} disabled={lookup.isPending || disabled}
            onChange={e => { setSearch(e.target.value); setSearchNotice(""); lookup.reset(); }} placeholder="Issuer or public card name" />
        </label>
        <p className="mt-1 text-xs text-[#68757F]">Search sends the name you type and the market, not your linked-card details. Don’t enter card numbers or personal information.</p>
        <Button size="sm" type="submit" variant="outline" className="mt-2" disabled={lookup.isPending || disabled || !search.trim()}>
          {lookup.isPending ? "Searching…" : "Search"}
        </Button>
      </form>
      {searchNotice && <p role="alert" className="mt-2 text-xs text-[#8A3B3B]">{searchNotice}</p>}
      {!!choices.length && <ul className="mt-2 space-y-2" aria-label="Built-in matches">
        {choices.map(p => <li key={p.id} className="flex flex-wrap justify-between gap-2 border-t pt-2 text-sm">
          <span>{p.name} <span className="text-xs text-[#68757F]">(built-in rates)</span></span>
          <Button size="sm" variant="outline" disabled={disabled || mutation.isPending || p.id === selected?.id}
            onClick={() => mutation.mutate({ productId: p.id })}>{p.id === selected?.id ? "Selected" : "Use this product"}</Button>
        </li>)}
      </ul>}
      {!!lookup.data?.matches.length && <ul className="mt-2 space-y-2" aria-label="Web matches">
        {lookup.data.matches.map(match => <li key={match.name} className="border-t pt-2 text-sm">
          <p className="break-words font-medium">{match.name}</p>
          <a href={match.source.url} target="_blank" rel="noreferrer" className="break-words text-xs text-[#1F3A5F] underline">Check terms ({new URL(match.source.url).hostname})</a>
          <Button size="sm" variant="outline" className="ml-2" disabled={disabled || mutation.isPending} onClick={() => fillRates(match)}>Review rates</Button>
        </li>)}
      </ul>}
      {lookup.error && <p role="alert" className="mt-2 text-xs text-[#8A3B3B]">{lookup.error.message}</p>}
      {lookup.data?.enabled === false && <p className="mt-2 text-xs">In-app web search isn’t configured yet. You can still search in your browser and enter rates.</p>}
      {lookup.data?.enabled && !lookup.data.matches.length && <>
        <p className="mt-2 text-xs">No sourced rate draft was found. Check the results or enter the issuer’s rates manually.</p>
        {!!lookup.data.sources.length && <ul className="mt-2 space-y-1 text-xs">
          {lookup.data.sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer" className="break-words text-[#1F3A5F] underline">{source.title}</a></li>)}
        </ul>}
      </>}
      {query && !lookup.isPending && <a className="mt-2 inline-block text-xs text-[#1F3A5F] underline" target="_blank" rel="noreferrer"
        href={`https://duckduckgo.com/?q=${encodeURIComponent(`${query} ${market === "CA" ? "Canada" : "United States"} credit card rewards issuer terms`)}`}>
        Open web search in your browser
      </a>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setCustom(!custom)}>{custom ? "Hide custom rates" : "Enter custom rates"}</Button>
        {card.rewardRules && <Button size="sm" variant="ghost" disabled={disabled || mutation.isPending} onClick={() => mutation.mutate({ rules: null })}>Clear rewards</Button>}
      </div>
      {custom && <form onSubmit={submitCustom} className="mt-3 space-y-2">
        {draftMatch && <p className="text-sm font-medium">
          Review {draftMatch.name} before saving. Web-suggested rates can be wrong or incomplete. <a href={draftMatch.source.url} target="_blank" rel="noreferrer" className="text-[#1F3A5F] underline">Check the source</a>.
        </p>}
        <p className="text-xs text-[#68757F]">Use the exact rewards program name. Enter “Cash back” for percentage rates. Only enter bonuses that apply to the whole category; caps and special offers aren’t tracked here.</p>
        <label className="block text-sm">Rewards program<Input value={unit} onChange={e => setUnit(e.target.value)} required maxLength={40} /></label>
        <label className="block text-sm">Base points per dollar or cash-back %<Input required type="number" min="0" max="50" step="0.01" value={base} onChange={e => setBase(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2">
          {rewardCategories.map(category => <label key={category} className="text-xs">{category}
            <Input type="number" min="0" max="50" step="0.01" placeholder="Base" value={rates[category] ?? ""} onChange={e => setRates(v => ({ ...v, [category]: e.target.value }))} />
          </label>)}
        </div>
        <Button size="sm" type="submit" disabled={disabled || mutation.isPending}>{draftMatch ? "Save reviewed product and rates" : "Save custom rates"}</Button>
      </form>}
      {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
      {mutation.error && <p role="alert" className="mt-2 text-xs text-[#8A3B3B]">{mutation.error.message}</p>}
    </details>
  );
}
