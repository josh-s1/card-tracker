import { useContext, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { PinContext } from "@/App";
import { api, loadPlaidLink } from "@/lib/api";
import type { AppState } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Plug, RefreshCw, Trash2, Sparkles, ShieldCheck } from "lucide-react";

interface Config {
  plaidConfigured: boolean;
  plaidEnv: string;
  pinRequired: boolean;
}

export default function ConnectPage() {
  const { pin } = useContext(PinContext);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [linkBusy, setLinkBusy] = useState(false);

  const config = useQuery<Config>({
    queryKey: ["config", pin],
    queryFn: api.config,
  });
  const { data, isLoading } = useQuery<AppState>({
    queryKey: ["state", pin],
    queryFn: api.state,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["state", pin] });
  };

  const syncMutation = useMutation({
    mutationFn: api.sync,
    onSuccess: (res: any) => {
      invalidate();
      if (res.errors?.length) {
        toast({
          title: "Sync finished with problems",
          description: res.errors.join(" · "),
          variant: "destructive",
        });
      } else {
        toast({ title: "Cards are up to date", description: "Latest balances and transactions pulled from your banks." });
      }
    },
    onError: (e: Error) => {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => api.removeItem(itemId),
    onSuccess: () => {
      invalidate();
      toast({ title: "Bank disconnected", description: "Its cards and transactions were removed." });
    },
    onError: (e: Error) => {
      toast({ title: "Could not disconnect", description: e.message, variant: "destructive" });
    },
  });

  const demoSeed = useMutation({
    mutationFn: api.seedDemo,
    onSuccess: () => {
      invalidate();
      toast({ title: "Sample data loaded", description: "Three example cards with sample transactions." });
    },
  });

  const clearReal = useMutation({
    mutationFn: api.clearReal,
    onSuccess: () => {
      invalidate();
      toast({ title: "Real bank data cleared", description: "Sample data remains untouched." });
    },
  });

  const startLink = async () => {
    setLinkBusy(true);
    try {
      await loadPlaidLink();
      const { link_token } = await api.linkToken();
      const handler = (window as any).Plaid.create({
        token: link_token,
        onSuccess: async (publicToken: string) => {
          toast({ title: "Connecting your bank…", description: "Pulling balances and transactions." });
          try {
            await api.exchange(publicToken);
            invalidate();
            toast({ title: "Bank connected", description: "Your cards are now being tracked." });
          } catch (e: any) {
            toast({ title: "Connection failed", description: e.message, variant: "destructive" });
          }
        },
        onExit: () => setLinkBusy(false),
      });
      handler.open();
    } catch (e: any) {
      toast({ title: "Could not start bank connection", description: e.message, variant: "destructive" });
      setLinkBusy(false);
    }
  };

  if (isLoading || config.isLoading) {
    return <Skeleton className="h-96 w-full rounded-2xl" />;
  }

  if (!data) return null;

  const realItems = data.items.filter((i) => !i.isDemo);
  const hasDemo = data.items.some((i) => i.isDemo);

  return (
    <div>
      <h1 className="mb-1 text-[15px] font-semibold text-[#68757F]">Connect</h1>
      <p className="mb-5 text-sm text-[#68757F]">
        Link your banks once — cards, balances and transactions then stay in sync
        automatically.
      </p>

      {config.data?.plaidConfigured ? (
        <div className="rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgba(20,33,43,0.04)]">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#EAF0F5] text-[#1F3A5F]">
              <ShieldCheck size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold">Bank connection is live</div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-[#68757F]">
                You sign in through Plaid's secure window — your bank password is
                never seen by this app.
              </p>
            </div>
          </div>
          <Button
            onClick={startLink}
            disabled={linkBusy}
            className="mt-4 w-full bg-[#1F3A5F] hover:bg-[#152B49]"
            data-testid="button-connect-bank"
          >
            <Plug size={16} className="mr-1.5" />
            {linkBusy ? "Opening Plaid…" : "Connect a bank"}
          </Button>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E8D9BF] bg-[#FDF8EF] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-[#F5E8CF] text-[#8A6A1F]">
              <Sparkles size={18} />
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold">
                Running on sample data
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-[#68757F]">
                The server doesn't have Plaid keys yet. Once they're added, a
                "Connect a bank" button appears here and your real cards sync
                automatically.
              </p>
            </div>
          </div>
        </div>
      )}

      {realItems.length > 0 && (
        <>
          <div className="mb-2 mt-6 text-[15px] font-semibold">
            Connected banks
          </div>
          <div className="space-y-2">
            {realItems.map((item) => {
              const nAccounts = data.accounts.filter(
                (a) => a.itemId === item.id,
              ).length;
              const nTxns = data.transactions.filter(
                (t) => t.itemId === item.id,
              ).length;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl bg-white p-3.5 shadow-[0_1px_2px_rgba(20,33,43,0.04)]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold">
                      {item.institutionName}
                    </div>
                    <div className="mt-0.5 text-xs text-[#68757F]">
                      {nAccounts} card{nAccounts === 1 ? "" : "s"} ·{" "}
                      {nTxns} transaction{nTxns === 1 ? "" : "s"}
                      {item.lastSyncedAt
                        ? ` · synced ${new Date(item.lastSyncedAt).toLocaleString(
                            "en-US",
                            { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
                          )}`
                        : ""}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Disconnect ${item.institutionName}`}
                    onClick={() => removeMutation.mutate(item.id)}
                    data-testid={`button-remove-${item.id}`}
                  >
                    <Trash2 size={16} className="text-[#B23B3B]" />
                  </Button>
                </div>
              );
            })}
          </div>
          <Button
            variant="outline"
            className="mt-3 w-full border-[#D9DEE2]"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            <RefreshCw
              size={15}
              className={`mr-1.5 ${syncMutation.isPending ? "animate-spin" : ""}`}
            />
            {syncMutation.isPending ? "Syncing…" : "Sync now"}
          </Button>
        </>
      )}

      <div className="mb-2 mt-6 text-[15px] font-semibold">Sample data</div>
      <div className="space-y-2">
        {hasDemo && (
          <div className="rounded-xl bg-white p-3.5 shadow-[0_1px_2px_rgba(20,33,43,0.04)]">
            <div className="text-[15px] font-semibold">Demo cards</div>
            <div className="mt-0.5 text-xs text-[#68757F]">
              Three sample cards — safe to explore, replaced by your real cards
              when you connect.
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1 border-[#D9DEE2] text-[13px]"
            onClick={() => demoSeed.mutate()}
            disabled={demoSeed.isPending}
          >
            Reload samples
          </Button>
          <Button
            variant="outline"
            className="flex-1 border-[#D9DEE2] text-[13px] text-[#B23B3B]"
            onClick={() => clearReal.mutate()}
            disabled={clearReal.isPending || realItems.length === 0}
          >
            Clear real data
          </Button>
        </div>
      </div>
    </div>
  );
}
