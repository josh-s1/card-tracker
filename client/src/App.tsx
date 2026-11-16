import { createContext, useState } from "react";
import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import UnlockPage from "@/pages/UnlockPage";
import CardsPage from "@/pages/CardsPage";
import CardDetailPage from "@/pages/CardDetailPage";
import ActivityPage from "@/pages/ActivityPage";
import SpendingPage from "@/pages/SpendingPage";
import ConnectPage from "@/pages/ConnectPage";
import { api, setPin, getPin, LockedError } from "./lib/api";
import { CreditCard, List, PieChart, Plug, Lock } from "lucide-react";
import { Link } from "wouter";
import { PREVIEW_STATE } from "./lib/previewState";

// When the frontend is served without its backend (e.g. a static preview
// deployment), fall back to the embedded sample data instead of showing errors.
let previewMode = false;
export const isPreviewMode = () => previewMode;
const originalFetch = window.fetch;
const jsonRes = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const previewResponseFor = (url: string) => {
  if (url.includes("/api/config")) {
    return jsonRes({ plaidConfigured: false, plaidEnv: "static", pinRequired: false });
  }
  if (url.includes("/api/state")) return jsonRes(PREVIEW_STATE);
  if (url.includes("/api/plaid/link-token")) {
    return new Response(
      JSON.stringify({ error: "Preview mode — bank connections need the hosted app." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  return jsonRes({ ok: true });
};
window.fetch = async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : (input?.url ?? "");
  if (url.includes("/api/")) {
    try {
      const res = await originalFetch(input, init);
      if (res.ok) return res;
      if (res.status === 404 || res.status === 405) {
        previewMode = true;
        return previewResponseFor(url);
      }
      return res;
    } catch {
      previewMode = true;
      return previewResponseFor(url);
    }
  }
  return originalFetch(input, init);
};

export const PinContext = createContext<{ pin: string; setPin: (p: string) => void }>({
  pin: "",
  setPin: () => {},
});

function TabBar({ current }: { current: string }) {
  const tabs = [
    { key: "cards", label: "Cards", icon: CreditCard, href: "/" },
    { key: "activity", label: "Activity", icon: List, href: "/activity" },
    { key: "spending", label: "Spending", icon: PieChart, href: "/spending" },
    { key: "connect", label: "Connect", icon: Plug, href: "/connect" },
  ];
  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-[430px] -translate-x-1/2 border-t border-[hsl(214_20%_88%)] bg-white px-2 pb-[max(10px,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_16px_rgba(20,33,43,0.05)]">
      <div className="flex">
        {tabs.map((t) => {
          const active = current === t.key;
          const Icon = t.icon;
          return (
            <Link
              key={t.key}
              href={t.href}
              className="flex flex-1 flex-col items-center gap-1 rounded-lg py-1 text-xs font-medium"
              style={{ color: active ? "#1F3A5F" : "#68757F" }}
            >
              <Icon size={21} strokeWidth={active ? 2.2 : 1.8} />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function Shell() {
  const [location] = useHashLocation();
  const current = location.startsWith("/card")
    ? "cards"
    : location.startsWith("/activity")
      ? "activity"
      : location.startsWith("/spending")
        ? "spending"
        : location.startsWith("/connect")
          ? "connect"
          : "cards";
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col bg-[#F2F4F6] shadow-[0_0_40px_rgba(20,33,43,0.08)] sm:my-0">
      {isPreviewMode() && (
        <div className="bg-[#4A2C4F] px-4 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-white">
          Preview — sample data
        </div>
      )}
      <main className="flex-1 px-4 pb-24 pt-6">
        <Switch>
          <Route path="/" component={CardsPage} />
          <Route path="/card/:id" component={CardDetailPage} />
          <Route path="/activity" component={ActivityPage} />
          <Route path="/spending" component={SpendingPage} />
          <Route path="/connect" component={ConnectPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
      <TabBar current={current} />
    </div>
  );
}

function AppInner() {
  const [pin, setPinState] = useState<string>(getPin());
  const config = useQuery({
    queryKey: ["config"],
    queryFn: api.config,
    retry: false,
  });

  const updatePin = (p: string) => {
    setPin(p);
    setPinState(p);
    queryClient.invalidateQueries();
  };

  if (config.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-[#68757F]">
        <div className="flex flex-col items-center gap-3">
          <Lock size={22} />
          <span className="text-sm">Loading Card Tracker…</span>
        </div>
      </div>
    );
  }

  const needsPin = config.data?.pinRequired && !pin;

  return (
    <PinContext.Provider value={{ pin, setPin: updatePin }}>
      {needsPin ? (
        <UnlockPage onUnlocked={updatePin} />
      ) : (
        <Shell />
      )}
      <Toaster />
    </PinContext.Provider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router hook={useHashLocation}>
          <AppInner />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
