import { useContext, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PinContext } from "@/App";
import { useDashboardState } from "@/lib/dashboard-state";
import { cardName } from "@/lib/format";
import { SpendingPanel } from "./SpendingPanel";

export default function SpendingPage() {
  const { pin } = useContext(PinContext);
  const { data, isLoading, error } = useDashboardState(pin);
  const [card, setCard] = useState<string>("all");

  if (isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (error) return <p className="text-sm text-[#8A3B3B]">{(error as Error).message}</p>;
  if (!data) return null;

  const cards = data.accounts;
  const txns =
    card === "all"
      ? data.transactions
      : data.transactions.filter((t) => t.accountId === card);

  return (
    <div>
      <h1 className="mb-3 text-[15px] font-semibold text-[#68757F]">Spending</h1>

      <div className="mb-4 flex overflow-x-auto pb-3 [-ms-overflow-style:none] [scrollbar-width:none]">
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
          >
            {cardName(c)}
          </button>
        ))}
      </div>

      <SpendingPanel txns={txns} months={6} />
    </div>
  );
}
