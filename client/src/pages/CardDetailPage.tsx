import { useContext, useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PinContext } from "@/App";
import { api } from "@/lib/api";
import { useDashboardState, useSampleMode } from "@/lib/dashboard-state";
import {
  money,
  money0,
  fmtDate,
  dueText,
  cardName,
  bankSyncLabel,
} from "@/lib/format";
import { SpendingPanel } from "./SpendingPanel";
import { TxnList } from "./TxnList";

export default function CardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { pin } = useContext(PinContext);
  const sample = useSampleMode();
  const [tab, setTab] = useState<"txns" | "spend">("txns");
  const [renaming, setRenaming] = useState(false);
  const [nickname, setNickname] = useState("");
  const queryClient = useQueryClient();
  const rename = useMutation({
    mutationFn: ({ accountId, nickname }: { accountId: string; nickname: string }) =>
      api.renameCard(accountId, nickname),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["state", pin, false] });
      setRenaming(false);
    },
  });
  const { data, isLoading, error } = useDashboardState(pin);

  if (isLoading) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (error) return <p className="text-sm text-[#8A3B3B]">{(error as Error).message}</p>;
  if (!data) return null;

  const card = data.accounts.find((a) => a.id === id);
  if (!card) {
    return (
      <div className="py-16 text-center text-sm text-[#68757F]">
        Card not found.{" "}
        <Link href="/" className="font-semibold text-[#1F3A5F]">
          Back to cards
        </Link>
      </div>
    );
  }

  const txns = data.transactions.filter((t) => t.accountId === card.id);
  const util = card.limitCents
    ? Math.round((card.balanceCents / card.limitCents) * 100)
    : 0;

  return (
    <div>
      <Link
        href="/"
        className="-ml-1.5 mb-3 inline-flex items-center gap-0.5 text-[15px] font-semibold text-[#1F3A5F]"
      >
        ← All cards
      </Link>

      <div
        className="rounded-[18px] p-5 text-white shadow-[0_8px_24px_rgba(20,33,43,0.2)]"
        style={{ background: card.color }}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 flex-1 break-words font-semibold">{cardName(card)}</span>
          <span className="shrink-0 text-[12.5px] opacity-80">
            {card.network ? `${card.network} ` : ""}
            {card.mask}
          </span>
        </div>
        <div className="my-3 text-4xl font-bold tracking-tight tabular-nums">
          {money(card.balanceCents, card.currency)}
        </div>
        <div className="h-[5px] overflow-hidden rounded-full bg-white/20">
          <i
            className="block h-full rounded-full bg-white"
            style={{ width: `${Math.min(util, 100)}%` }}
          />
        </div>
        <div className="mt-2.5 flex justify-between text-[12.5px] opacity-90 tabular-nums">
          <span>
            {money((card.limitCents ?? 0) - card.balanceCents, card.currency)} available
          </span>
          <span>
            {util}% of {money0(card.limitCents ?? 0, card.currency)}
          </span>
        </div>
      </div>

      <p className="mt-3 text-xs font-medium text-[#41525E]">{bankSyncLabel(data.items.find(i => i.id === card.itemId))}</p>
      {!sample && <div className="mt-3 rounded-xl bg-white p-3.5">
        <p className="break-words text-xs text-[#68757F]">Bank name: {card.name}</p>
        {renaming ? (
          <form className="mt-3 space-y-3" onSubmit={event => {
            event.preventDefault();
            if (!rename.isPending) rename.mutate({ accountId: card.id, nickname });
          }}>
            <label htmlFor="card-nickname" className="block text-sm font-semibold">Card nickname</label>
            <Input
              id="card-nickname"
              value={nickname}
              maxLength={80}
              disabled={rename.isPending}
              onChange={event => setNickname(event.target.value)}
              placeholder={card.name}
              aria-describedby="nickname-help"
              autoFocus
              data-testid="input-card-nickname"
            />
            <p id="nickname-help" className="text-xs text-[#68757F]">
              Leave blank to use the bank name. Syncing will not overwrite your nickname.
            </p>
            {rename.error && <p role="alert" className="text-sm text-[#8A3B3B]">{rename.error.message}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={rename.isPending} data-testid="button-save-nickname">
                {rename.isPending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline" disabled={rename.isPending}
                onClick={() => setRenaming(false)} data-testid="button-cancel-nickname">
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="outline" className="mt-2"
            onClick={() => { setNickname(card.nickname ?? ""); rename.reset(); setRenaming(true); }}
            data-testid="button-rename-card">
            Rename card
          </Button>
        )}
      </div>}

      <SectionTitle>Payment</SectionTitle>
      <div className="rounded-xl bg-white px-4 py-1 shadow-[0_1px_2px_rgba(20,33,43,0.04)]">
        <Row label="Due date">
          {card.dueDate ? `${fmtDate(card.dueDate)}, ${dueText(card.dueDate)}` : "—"}
        </Row>
        <Row label="Minimum due">{money(card.minDueCents ?? 0, card.currency)}</Row>
        <Row label="Statement balance">
          {money(card.statementBalanceCents ?? 0, card.currency)}
        </Row>
        <Row label="Last payment">
          {card.lastPaymentCents != null
            ? `${money(card.lastPaymentCents, card.currency)}${
                card.lastPaymentDate ? ` on ${fmtDate(card.lastPaymentDate)}` : ""
              }`
            : "—"}
        </Row>
      </div>

      <SectionTitle>Statement</SectionTitle>
      <div className="rounded-xl bg-white px-4 py-1 shadow-[0_1px_2px_rgba(20,33,43,0.04)]">
        <Row label="Next statement closes">
          {card.statementCloseDate ? fmtDate(card.statementCloseDate) : "—"}
        </Row>
        <Row label="Interest rate (APR)">{card.apr ? `${card.apr}%` : "—"}</Row>
        <Row label="Card type">{card.subtype || card.type}</Row>
      </div>

      <div className="my-5 flex rounded-xl bg-[#DDE2E6] p-[3px]">
        <button
          aria-pressed={tab === "txns"}
          onClick={() => setTab("txns")}
          className="flex-1 rounded-lg py-2 text-[13.5px] font-medium text-[#68757F] aria-pressed:bg-white aria-pressed:text-[#14212B] aria-pressed:shadow-sm"
        >
          Transactions
        </button>
        <button
          aria-pressed={tab === "spend"}
          onClick={() => setTab("spend")}
          className="flex-1 rounded-lg py-2 text-[13.5px] font-medium text-[#68757F] aria-pressed:bg-white aria-pressed:text-[#14212B] aria-pressed:shadow-sm"
        >
          Spending
        </button>
      </div>

      {tab === "txns" ? (
        <TxnList txns={txns} />
      ) : (
        <SpendingPanel txns={txns} months={6} />
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-5 text-[15px] font-semibold">{children}</div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-[#D9DEE2] py-3 text-[14.5px] last:border-0">
      <span className="text-[#68757F]">{label}</span>
      <span className="font-semibold tabular-nums">{children}</span>
    </div>
  );
}
