import { useContext, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";
import { PinContext } from "@/App";
import { useDashboardState, useSampleMode } from "@/lib/dashboard-state";
import { cardName } from "@/lib/format";
import { TxnList } from "./TxnList";
import { CardRecommendation } from "./CardRewards";

export default function ActivityPage({ plannerOpen }: { plannerOpen?: boolean }) {
  const { pin } = useContext(PinContext);
  const sample = useSampleMode();
  const { data, isLoading, error } = useDashboardState(pin);
  const [card, setCard] = useState<string>("all");
  const [q, setQ] = useState("");

  const accountById = useMemo(
    () => Object.fromEntries((data?.accounts ?? []).map((a) => [a.id, a])),
    [data],
  );

  if (isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (error) return <p className="text-sm text-[#8A3B3B]">{(error as Error).message}</p>;
  if (!data) return null;

  const cards = data.accounts;
  const rewardCards = cards.filter(c => c.type === "credit" && !data.items.find(i => i.id === c.itemId)?.disconnectPending);
  const ql = q.toLowerCase();
  const txns = data.transactions.filter(
    (t) =>
      (card === "all" || t.accountId === card) &&
      (!q ||
        (t.merchantName || t.name).toLowerCase().includes(ql) ||
        t.category.toLowerCase().includes(ql)),
  );

  return (
    <div>
      <h1 className="mb-3 text-[15px] font-semibold text-[#68757F]">Activity</h1>

      <details open={plannerOpen} className="mb-3 rounded-xl border border-[#D9DEE2] bg-white">
        <summary className="cursor-pointer px-3 py-3 text-sm font-semibold text-[#1F3A5F]" data-testid="open-card-recommendation">
          Which card should I use?
        </summary>
        <div className="border-t border-[#E7EBEE] bg-[#F2F4F6] p-3">
          <CardRecommendation cards={rewardCards} sample={sample} />
        </div>
      </details>

      <label className="mb-3 flex items-center gap-2 rounded-xl border border-[#D9DEE2] bg-white px-3 shadow-[0_1px_2px_rgba(20,33,43,0.04)]">
        <Search size={18} className="flex-none text-[#68757F]" />
        <input
          placeholder="Search merchant or category"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full border-0 bg-transparent py-3 text-[15px] outline-none placeholder:text-[#9AA4AB]"
          data-testid="input-search"
        />
      </label>

      <div className="mb-1 flex overflow-x-auto pb-3 [-ms-overflow-style:none] [scrollbar-width:none]">
        <button
          aria-pressed={card === "all"}
          onClick={() => setCard("all")}
          className="mr-2 flex-none rounded-full border border-[#D9DEE2] bg-white px-3 py-1.5 text-[13px] font-medium text-[#68757F] aria-pressed:border-[#14212B] aria-pressed:bg-[#14212B] aria-pressed:text-white"
        >
          All cards
        </button>
        {cards.map((c) => (
          <button
            key={c.id}
            aria-pressed={card === c.id}
            onClick={() => setCard(c.id)}
            className="mr-2 flex-none rounded-full border border-[#D9DEE2] bg-white px-3 py-1.5 text-[13px] font-medium text-[#68757F] aria-pressed:border-[#14212B] aria-pressed:bg-[#14212B] aria-pressed:text-white"
            data-testid={`chip-${c.mask}`}
          >
            {cardName(c)}
          </button>
        ))}
      </div>

      <p className="mb-2 text-xs text-[#68757F]">
        These are estimates using current rates, not points posted by the issuer. Bonus eligibility can depend on merchant coding, purchase details or caps that aren’t visible here.
      </p>
      <TxnList txns={txns} showCard accountById={accountById} rewardCards={rewardCards} />
    </div>
  );
}
