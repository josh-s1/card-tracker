import type { Transaction, Account } from "@shared/schema";
import { money, catColor, displayMerchant, dayLabel, cardName, estimateLabel } from "@/lib/format";
import { purchaseEligible, transactionEstimate } from "@shared/rewards";

export function TxnList({
  txns,
  showCard,
  accountById,
  rewardCards,
}: {
  txns: Transaction[];
  showCard?: boolean;
  accountById?: Record<string, Account>;
  rewardCards?: Account[];
}) {
  if (!txns.length) {
    return (
      <div className="py-9 text-center text-[14.5px] text-[#68757F]">
        No transactions match.
      </div>
    );
  }
  const sorted = [...txns].sort((a, b) => (a.date < b.date ? 1 : -1));
  const groups: { d: string; items: Transaction[] }[] = [];
  for (const t of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.d === t.date) last.items.push(t);
    else groups.push({ d: t.date, items: [t] });
  }
  return (
    <div>
      {groups.map((g) => (
        <div key={g.d}>
          <div className="mb-1.5 mt-4 text-[13px] font-semibold text-[#68757F]">
            {dayLabel(g.d)}
          </div>
          <div className="rounded-xl bg-white px-4 py-0.5 shadow-[0_1px_2px_rgba(20,33,43,0.04)]">
            {g.items.map((t) => {
              const acct = accountById?.[t.accountId];
              const showRewards = rewardCards && acct?.type === "credit" && purchaseEligible(t);
              const currencyMatches = !t.rewardContext || t.rewardContext.currency === acct?.currency;
              const earned = showRewards ? transactionEstimate(acct, t, acct.currency) : null;
              const alternatives = showRewards
                ? rewardCards.filter(c => c.id !== acct.id)
                    .map(c => transactionEstimate(c, t, acct.currency)).filter(row => row !== null)
                : [];
              return (
                <div
                  key={t.id}
                  className="border-b border-[#EAEDEF] py-2.5 last:border-0"
                  data-testid={`txn-${t.id}`}
                >
                  <div className="flex items-center gap-3">
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-full"
                    style={{ background: catColor(t.category) }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">
                      {displayMerchant(t)}
                    </div>
                    <div className="mt-0.5 break-words text-xs text-[#68757F]">
                      {t.category}
                      {showCard && acct ? `, ${cardName(acct)} ${acct.mask}` : ""}
                      {t.pending ? ", pending" : ""}
                    </div>
                  </div>
                  <div
                    className={`text-[15px] font-semibold tabular-nums ${
                      t.amountCents < 0 ? "text-[#2E7D4F]" : ""
                    }`}
                  >
                    {t.amountCents < 0 ? "+" : ""}
                    {money(Math.abs(t.amountCents), t.rewardContext?.currency ?? acct?.currency)}
                  </div>
                  </div>
                  {showRewards && (
                    <div className="ml-5 mt-2 space-y-1 break-words text-xs text-[#41525E]">
                      <p><span className="font-semibold">Estimated on this card:</span> {earned ? estimateLabel(earned, acct.currency) : currencyMatches ? "Set the card product to calculate" : "Currency does not match or is unavailable"}</p>
                      {currencyMatches && (alternatives.length
                        ? alternatives.map(row => <p key={row.card.id}>With {cardName(row.card)}: {estimateLabel(row, acct.currency)} est.</p>)
                        : <p>No other configured card in {acct.currency}.</p>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
