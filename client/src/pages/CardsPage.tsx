import { useContext } from "react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { PinContext } from "@/App";
import { useDashboardState } from "@/lib/dashboard-state";
import {
  money,
  money0,
  dueText,
  fmtDate,
  creditCards,
  cardName,
  bankSyncLabel,
} from "@/lib/format";

export default function CardsPage() {
  const { pin } = useContext(PinContext);
  const { data, isLoading, error } = useDashboardState(pin);

  if (isLoading) return <CardsSkeleton />;
  if (error) return <ErrorNote message={(error as Error).message} />;
  if (!data) return null;

  const cards = creditCards(data);
  const others = data.accounts.filter((a) => a.type !== "credit");
  const totalOwed = cards.reduce((s, c) => s + c.balanceCents, 0);
  const totalAvail = cards.reduce((s, c) => s + (c.limitCents ?? 0) - c.balanceCents, 0);
  const withDue = cards
    .filter((c) => c.dueDate)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const next = withDue[0];
  const isDemo = data.items.some((i) => i.isDemo) && data.items.every((i) => i.isDemo);

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h1 className="text-[15px] font-semibold text-[#68757F]">Total balance</h1>
        {isDemo && (
          <span className="rounded-full bg-[#DCE3E8] px-2.5 py-0.5 text-[11px] font-semibold text-[#41525E]">
            Sample data
          </span>
        )}
      </div>
      <div className="mt-1 text-[40px] font-bold leading-none tracking-tight tabular-nums">
        {money(totalOwed)}
      </div>
      <div className="mt-2 text-sm text-[#68757F] tabular-nums">
        {money0(totalAvail)} available across {cards.length} card{cards.length === 1 ? "" : "s"}
      </div>

      {next && (
        <div className="mt-5 rounded-r-lg border-l-[3px] border-[#B26A00] bg-white p-3.5 text-sm shadow-[0_1px_2px_rgba(20,33,43,0.04)]">
          Next payment:{" "}
          <span className="break-words font-semibold">{cardName(next)}</span>,{" "}
          {money(next.minDueCents ?? 0)} minimum by {fmtDate(next.dueDate!)} (
          {dueText(next.dueDate!)})
        </div>
      )}

      <Link href="/rewards" className="mt-4 block rounded-xl border border-[#D9DEE2] bg-white px-4 py-3 text-sm font-semibold text-[#1F3A5F]">
        Which card should I use?
      </Link>
      <div className="mt-6 space-y-3.5">
        {cards.map((c) => {
          const util = c.limitCents
            ? Math.round((c.balanceCents / c.limitCents) * 100)
            : 0;
          return (
            <Link
              key={c.id}
              href={`/card/${c.id}`}
              data-testid={`card-${c.mask}`}
              className="block rounded-2xl p-4 text-white shadow-[0_6px_18px_rgba(20,33,43,0.16)] transition-transform active:scale-[0.985]"
              style={{ background: c.color }}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1 break-words text-[15px] font-semibold">{cardName(c)}</span>
                <span className="shrink-0 text-xs opacity-75">
                  {c.network ? `${c.network} ` : ""}
                  {c.mask}
                </span>
              </div>
              <div className="my-3.5 text-[30px] font-bold leading-none tracking-tight tabular-nums">
                {money(c.balanceCents, c.currency)}
              </div>
              <div className="h-[5px] overflow-hidden rounded-full bg-white/20">
                <i
                  className="block h-full rounded-full bg-white"
                  style={{ width: `${Math.min(util, 100)}%` }}
                />
              </div>
              <div className="mt-2.5 flex justify-between text-[12.5px] opacity-90 tabular-nums">
                <span>
                  {util}% of {money0(c.limitCents ?? 0, c.currency)} limit
                </span>
                <span>
                  {c.dueDate ? `Payment ${dueText(c.dueDate)}` : ""}
                </span>
              </div>
              <p className="mt-2.5 text-xs opacity-90">{bankSyncLabel(data.items.find(i => i.id === c.itemId))}</p>
            </Link>
          );
        })}
        {others.length > 0 && (
          <p className="pt-2 text-center text-xs text-[#68757F]">
            {others.length} non-card account{others.length === 1 ? "" : "s"} also linked —
            see Connect.
          </p>
        )}
      </div>
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-10 w-56" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-12 w-full" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-36 w-full rounded-2xl" />
      ))}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-[#E5C2C2] bg-[#FBF0F0] p-4 text-sm text-[#8A3B3B]">
      {message}
    </div>
  );
}
