import { useMemo, useState } from "react";
import type { Transaction } from "@shared/schema";
import { money, catColor, recentMonths, monthLabel } from "@/lib/format";

export function SpendingPanel({
  txns,
  months = 6,
}: {
  txns: Transaction[];
  months?: number;
}) {
  const monthOptions = useMemo(() => recentMonths(months), [months]);
  const [month, setMonth] = useState(monthOptions[0]?.key ?? "");
  const [by, setBy] = useState<"category" | "merchant">("category");

  const rows = useMemo(() => {
    const spend = txns.filter((t) => t.amountCents > 0 && t.date.startsWith(month));
    const map = new Map<
      string,
      { key: string; total: number; n: number; cat: string }
    >();
    for (const t of spend) {
      const k = by === "category" ? t.category : t.merchantName || t.name;
      const entry = map.get(k) ?? { key: k, total: 0, n: 0, cat: t.category };
      entry.total += t.amountCents;
      entry.n += 1;
      map.set(k, entry);
    }
    const list = Array.from(map.values()).sort((a, b) => b.total - a.total);
    return { list, total: spend.reduce((s, t) => s + t.amountCents, 0), count: spend.length };
  }, [txns, month, by]);

  const max = rows.list[0]?.total || 1;
  const isCurrentMonth = month === monthOptions[0]?.key;

  return (
    <div>
      <div className="flex overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none]">
        {monthOptions.map((m) => (
          <button
            key={m.key}
            aria-pressed={month === m.key}
            onClick={() => setMonth(m.key)}
            className="mr-2 flex-none rounded-full border border-[#D9DEE2] bg-white px-3 py-1.5 text-[13px] font-medium text-[#68757F] aria-pressed:border-[#14212B] aria-pressed:bg-[#14212B] aria-pressed:text-white"
          >
            {m.label.replace(", 20", " ")}
          </button>
        ))}
      </div>

      <div className="mt-5">
        <div className="text-sm text-[#68757F]">
          Spent in {monthLabel(month)}
          {isCurrentMonth ? " so far" : ""}
        </div>
        <div className="mt-1 text-[34px] font-bold leading-none tracking-tight tabular-nums">
          {money(rows.total)}
        </div>
        <div className="mt-1 text-sm text-[#68757F]">{rows.count} purchases</div>
      </div>

      <div className="mt-4 mb-2 flex rounded-xl bg-[#DDE2E6] p-[3px]">
        <button
          aria-pressed={by === "category"}
          onClick={() => setBy("category")}
          className="flex-1 rounded-lg py-2 text-[13.5px] font-medium text-[#68757F] aria-pressed:bg-white aria-pressed:text-[#14212B] aria-pressed:shadow-sm"
        >
          By category
        </button>
        <button
          aria-pressed={by === "merchant"}
          onClick={() => setBy("merchant")}
          className="flex-1 rounded-lg py-2 text-[13.5px] font-medium text-[#68757F] aria-pressed:bg-white aria-pressed:text-[#14212B] aria-pressed:shadow-sm"
        >
          By merchant
        </button>
      </div>

      {rows.list.length === 0 ? (
        <div className="py-9 text-center text-[14.5px] text-[#68757F]">
          No spending in {monthLabel(month)}.
        </div>
      ) : (
        <div className="rounded-xl bg-white px-4 py-1.5 shadow-[0_1px_2px_rgba(20,33,43,0.04)]">
          {rows.list.slice(0, 10).map((r) => (
            <div
              key={r.key}
              className="border-b border-[#EAEDEF] py-2.5 last:border-0"
            >
              <div className="flex items-baseline justify-between text-[14.5px]">
                <span className="truncate">
                  {r.key}
                  {by === "merchant" && (
                    <span className="text-[#68757F]">, {r.n}×</span>
                  )}
                </span>
                <span className="font-semibold tabular-nums">{money(r.total)}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded bg-[#E3E7EA]">
                <i
                  className="block h-full rounded"
                  style={{
                    width: `${(r.total / max) * 100}%`,
                    background: catColor(r.cat),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
