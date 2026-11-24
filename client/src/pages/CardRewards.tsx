import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cardName, estimateLabel } from "@/lib/format";
import type { Account } from "@shared/schema";
import {
  rewardCategories, rewardCatalog, findRewardProduct, normalizeRewardName, rewardGroups,
  type RewardRules,
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
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["state", pin, false] });
      setNotice("Reward settings saved.");
    },
  });
  const catalog = rewardCatalog.filter(p => p.currency === card.currency);
  const names = [card.name, card.officialName ?? ""].map(normalizeRewardName);
  const suggested = catalog.filter(p => [p.name, ...p.aliases].some(n => names.includes(normalizeRewardName(n))));
  const choices = catalog.filter(p => {
    const hay = normalizeRewardName([p.name, ...p.aliases].join(" "));
    return normalizeRewardName(search).split(" ").every(word => hay.includes(word));
  });
  const submitCustom = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || mutation.isPending) return;
    const bonuses = Object.fromEntries(Object.entries(rates)
      .filter(([, value]) => value.trim() !== "").map(([category, value]) => [category, Number(value)]));
    mutation.mutate({ rules: { unit, base: Number(base), bonuses } });
  };

  return (
    <details className="mt-1 rounded-lg bg-[#F2F4F6] p-2.5">
      <summary className="cursor-pointer break-words text-sm font-semibold text-[#1F3A5F]" data-testid={`select-card-product-${card.id}`}>
        {selected ? `Change card product · ${selected.name}` : card.rewardRules ? "Change card product · Custom rates" : "Select card product"}
      </summary>
      <p className="mt-2 break-words text-xs text-[#68757F]">Plaid name: {card.officialName || card.name} · {card.currency}</p>
      {selected && <p className="mt-2 text-xs leading-relaxed text-[#68757F]">
        {selected.terms} <a className="font-semibold text-[#1F3A5F] underline" href={selected.source} target="_blank" rel="noreferrer">Issuer terms</a> · Checked {selected.checked}
      </p>}
      <label className="mt-3 block space-y-1 text-sm">Search card products
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Issuer or card name" />
      </label>
      {!!suggested.length && !selected && <p className="mt-2 text-xs">Possible match from Plaid: {suggested.map(p => p.name).join(", ")}. Confirm the product before using its rates.</p>}
      <ul className="mt-2 space-y-2">
        {choices.map(p => <li key={p.id} className="flex flex-wrap justify-between gap-2 border-t pt-2 text-sm">
          <span>{p.name} <span className="text-xs text-[#68757F]">({p.currency === "CAD" ? "Canada" : "U.S."})</span></span>
          <Button size="sm" variant="outline" disabled={disabled || mutation.isPending || p.id === selected?.id}
            onClick={() => mutation.mutate({ productId: p.id })}>{p.id === selected?.id ? "Selected" : "Use this product"}</Button>
        </li>)}
      </ul>
      {!choices.length && <p className="mt-2 text-xs">No match in the current catalog. You can enter your own rates instead.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setCustom(!custom)}>{custom ? "Hide custom rates" : "Enter custom rates"}</Button>
        {card.rewardRules && <Button size="sm" variant="ghost" disabled={disabled || mutation.isPending} onClick={() => mutation.mutate({ rules: null })}>Clear rewards</Button>}
      </div>
      {custom && <form onSubmit={submitCustom} className="mt-3 space-y-2">
        <p className="text-xs text-[#68757F]">Use the exact rewards program name. Enter “Cash back” for percentage rates. Only enter bonuses that apply to the whole category; caps and special offers aren’t tracked here.</p>
        <label className="block text-sm">Rewards program<Input value={unit} onChange={e => setUnit(e.target.value)} required maxLength={40} /></label>
        <label className="block text-sm">Base points per dollar or cash-back %<Input required type="number" min="0" max="50" step="0.01" value={base} onChange={e => setBase(e.target.value)} /></label>
        <div className="grid grid-cols-2 gap-2">
          {rewardCategories.map(category => <label key={category} className="text-xs">{category}
            <Input type="number" min="0" max="50" step="0.01" placeholder="Base" value={rates[category] ?? ""} onChange={e => setRates(v => ({ ...v, [category]: e.target.value }))} />
          </label>)}
        </div>
        <Button size="sm" type="submit" disabled={disabled || mutation.isPending}>Save custom rates</Button>
      </form>}
      {notice && <p role="status" className="mt-2 text-xs">{notice}</p>}
      {mutation.error && <p role="alert" className="mt-2 text-xs text-[#8A3B3B]">{mutation.error.message}</p>}
    </details>
  );
}
