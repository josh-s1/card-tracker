import { useContext, useState } from "react";
import { useIsMutating, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PinContext } from "@/App";
import { api, loadPlaidLink, setShowSamples } from "@/lib/api";
import { useDashboardState, useSampleMode } from "@/lib/dashboard-state";
import { bankSyncLabel, cardName } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { Lock, Plug, RefreshCw, Trash2, Sparkles, ShieldCheck } from "lucide-react";
import { RewardProductEditor, rewardProductMutationKey } from "./CardRewards";

interface Config {
  plaidConfigured: boolean;
  plaidEnv: string;
  pinRequired: boolean;
  demoEnabled: boolean;
  rewardWebSearchConfigured?: boolean;
}

export default function SettingsPage() {
  const { pin, setPin } = useContext(PinContext);
  const sample = useSampleMode();

  return (
    <div>
      <h1 className="mb-3 text-[15px] font-semibold text-[#68757F]">Settings</h1>
      <BankConnections />
      {!sample && <IssuerRewardsSettings pin={pin} />}
      {pin && <div className="mt-6 border-t border-[#D9DEE2] pt-4">
        <Button type="button" variant="outline" className="w-full border-[#D9DEE2]" onClick={() => setPin("")} data-testid="button-lock-app">
          <Lock size={16} className="mr-1.5" /> Lock app
        </Button>
      </div>}
    </div>
  );
}

const issuerStatusLabels = {
  "rates-refreshed": "Supported rates refreshed",
  "listing-checked": "Issuer listing checked; rates not refreshed",
  "needs-review": "Page needs review; rates unchanged",
  unavailable: "Issuer page unavailable; rates unchanged",
};

function IssuerRewardsSettings({ pin }: { pin: string }) {
  const client = useQueryClient();
  const queryKey = ["issuer-rewards", pin];
  const { data, error, isPending } = useQuery({ queryKey, queryFn: api.issuerRewards });
  const sync = useMutation({
    mutationFn: api.syncIssuerRewards,
    onSuccess: (result) => {
      client.setQueryData(queryKey, result);
      return client.invalidateQueries({ queryKey: ["state", pin, false] });
    },
  });
  return (
    <section className="mt-6 rounded-xl bg-white p-4">
      <h2 className="text-[15px] font-semibold">Issuer rewards</h2>
      <p className="mt-1 text-xs leading-relaxed text-[#68757F]">
        Checks public U.S. Chase and Amex personal and business listings and refreshes supported rates for Sapphire Preferred and the no-fee Hilton Honors card. No new API key or bank login required.
      </p>
      <Button type="button" variant="outline" className="mt-3 w-full" onClick={() => sync.mutate()} disabled={sync.isPending} data-testid="sync-issuer-rewards">
        <RefreshCw size={15} className={sync.isPending ? "animate-spin" : undefined} />
        {sync.isPending ? "Checking issuer sites…" : "Sync rewards info"}
      </Button>
      {(sync.error || error) && <p role="alert" className="mt-2 text-xs text-[#8A3B3B]">{(sync.error || error)?.message}</p>}
      {isPending && <p role="status" className="mt-2 text-xs text-[#68757F]">Loading previous checks…</p>}
      {data?.some(row => row.check) && <ul className="mt-3 space-y-2 text-xs" aria-label="Issuer sync status">
        {data.map(({ source, check }) => <li key={source.id} className="border-t pt-2">
          <a href={source.url} target="_blank" rel="noreferrer" className="font-semibold text-[#1F3A5F] underline">{source.label}</a>
          <p className="mt-0.5 text-[#68757F]">
            {check ? `${issuerStatusLabels[check.status]} · ${new Date(check.checkedAt).toLocaleString()}` : "Not checked yet"}
          </p>
          {check?.ratesAt && check.status !== "rates-refreshed" && <p className="text-[#68757F]">
            Last usable issuer refresh: {new Date(check.ratesAt).toLocaleString()}
          </p>}
        </li>)}
      </ul>}
    </section>
  );
}

function BankConnections() {
  const { pin } = useContext(PinContext);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [linkBusy, setLinkBusy] = useState(false);
  const samplesVisible = useSampleMode();
  const savingProduct = useIsMutating({ mutationKey: rewardProductMutationKey }) > 0;

  const config = useQuery<Config>({
    queryKey: ["config", pin],
    queryFn: api.config,
    enabled: !samplesVisible,
  });
  const { data, isLoading, error: stateError, refetch: refetchState } = useDashboardState(pin);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["state", pin, false] });
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
      invalidate();
      toast({ title: "Could not disconnect", description: e.message, variant: "destructive" });
    },
  });

  const demoSeed = useMutation({
    mutationFn: api.seedDemo,
    onSuccess: () => {
      invalidate();
      toast({ title: "Sample data loaded", description: "Three example cards with sample transactions." });
    },
    onError: (e: Error) => {
      toast({ title: "Could not load samples", description: e.message, variant: "destructive" });
    },
  });

  const clearReal = useMutation({
    mutationFn: api.clearReal,
    onSuccess: () => {
      invalidate();
      toast({ title: "Banks disconnected", description: "Bank access was revoked and local bank data removed. Sample data remains untouched." });
    },
    onError: (e: Error) => {
      invalidate();
      toast({ title: "Disconnection incomplete", description: e.message, variant: "destructive" });
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
            const result = await api.exchange(publicToken);
            invalidate();
            toast(result.warnings?.length
              ? { title: "Bank connected; sync needs attention", description: result.warnings.join(" "), variant: "destructive" }
              : { title: "Bank connected", description: "Your cards are now being tracked." });
          } catch (e: any) {
            invalidate();
            toast({ title: "Connection failed", description: e.message, variant: "destructive" });
          } finally {
            setLinkBusy(false);
            handler.destroy?.();
          }
        },
        onExit: () => { setLinkBusy(false); handler.destroy?.(); },
      });
      handler.open();
    } catch (e: any) {
      toast({ title: "Could not start bank connection", description: e.message, variant: "destructive" });
      setLinkBusy(false);
    }
  };

  const sampleSwitch = (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-white p-3.5">
      <div>
        <label htmlFor="show-sample-cards" className="text-sm font-semibold">Show sample cards</label>
        <p id="sample-visibility-description" className="mt-0.5 text-xs text-[#68757F]">
          Hides real cards and activity in every tab. Nothing is deleted.
        </p>
      </div>
      <Switch id="show-sample-cards" aria-describedby="sample-visibility-description"
        checked={samplesVisible} onCheckedChange={setShowSamples}
        disabled={linkBusy || savingProduct || syncMutation.isPending || removeMutation.isPending || clearReal.isPending || demoSeed.isPending}
        data-testid="switch-show-sample-cards" />
    </div>
  );

  if (samplesVisible) return (
    <div>
      {sampleSwitch}
      <p className="rounded-xl bg-white p-3.5 text-sm text-[#41525E]">
        Demo Bank · Fictional cards and transactions only. Turn samples off to manage real bank connections.
      </p>
    </div>
  );

  if (isLoading || config.isLoading) {
    return <>{sampleSwitch}<Skeleton className="h-96 w-full rounded-2xl" /></>;
  }

  if (config.isError || stateError) {
    return (
      <div role="alert" className="space-y-3">
        {sampleSwitch}
        <p>Could not load bank connections. No connection or data changes were confirmed.</p>
        <Button variant="outline" onClick={() => { config.refetch(); refetchState(); }}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const realItems = data.items.filter((i) => !i.isDemo);

  return (
    <div>
      <h2 className="mb-1 text-[15px] font-semibold">Bank connections</h2>
      <p className="mb-5 text-sm text-[#68757F]">
        Link your banks, then use Sync now to refresh. Verify balances and payment
        details with your bank before making a payment.
      </p>
      {sampleSwitch}

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
                Bank connection not configured
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
          <h2 className="mb-2 mt-6 text-[15px] font-semibold">
            Connected banks
          </h2>
          <div className="space-y-2">
            {realItems.map((item) => {
              const accounts = data.accounts.filter((a) => a.itemId === item.id);
              const nAccounts = accounts.length;
              const nTxns = data.transactions.filter(
                (t) => t.itemId === item.id,
              ).length;
              return (
                <section
                  key={item.id}
                  className="rounded-xl bg-white p-3.5 shadow-[0_1px_2px_rgba(20,33,43,0.04)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="break-words text-[15px] font-semibold">
                        {item.institutionName}
                      </div>
                      <div className="mt-0.5 text-xs text-[#68757F]">
                        {nAccounts} card{nAccounts === 1 ? "" : "s"} ·{" "}
                        {nTxns} transaction{nTxns === 1 ? "" : "s"}
                        {` · ${bankSyncLabel(item)}`}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Disconnect ${item.institutionName}`}
                      disabled={savingProduct || removeMutation.isPending || clearReal.isPending}
                      onClick={() => {
                        if (window.confirm(`Disconnect ${item.institutionName}? This revokes bank access and deletes its cards and transactions from this app.`)) {
                          removeMutation.mutate(item.id);
                        }
                      }}
                      data-testid={`button-remove-${item.id}`}
                    >
                      <Trash2 size={16} className="text-[#B23B3B]" />
                    </Button>
                  </div>
                  {!item.disconnectPending && accounts.filter(a => a.type === "credit").map(card => (
                    <div key={card.id} className="mt-3 border-t border-[#E7EBEE] pt-3">
                      <h3 className="break-words text-sm font-medium">
                        {cardName(card)}{card.mask ? ` · •••• ${card.mask}` : ""}
                      </h3>
                      <RewardProductEditor card={card} pin={pin} webSearchConfigured={config.data?.rewardWebSearchConfigured}
                        disabled={removeMutation.isPending || clearReal.isPending} />
                    </div>
                  ))}
                </section>
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

      <div className="mt-5 space-y-2">
        <div className="flex gap-2">
          {config.data?.demoEnabled && (
            <Button
              variant="outline"
              className="flex-1 border-[#D9DEE2] text-[13px]"
              onClick={() => demoSeed.mutate()}
              disabled={demoSeed.isPending || clearReal.isPending || removeMutation.isPending}
            >
              Reload samples
            </Button>
          )}
          <Button
            variant="outline"
            className="flex-1 border-[#D9DEE2] text-[13px] text-[#B23B3B]"
            onClick={() => {
              if (window.confirm("Disconnect all banks? This revokes bank access and deletes all real bank cards and transactions from this app.")) {
                clearReal.mutate();
              }
            }}
            disabled={savingProduct || clearReal.isPending || removeMutation.isPending || realItems.length === 0}
          >
            Disconnect all banks
          </Button>
        </div>
      </div>
    </div>
  );
}
