import { createContext, useState, useEffect, useContext } from "react";
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

export const PinContext = createContext<{ pin: string; setPin: (p: string) => void }>({
  pin: "",
  setPin: () => {},
});

function TabBar({ current }: { current: string }) {
  const { pin, setPin: lock } = useContext(PinContext);
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
        {pin && (
          <button type="button" onClick={() => lock("")} className="flex flex-1 flex-col items-center gap-1 rounded-lg py-1 text-xs text-[#68757F]">
            <Lock size={21} /><span>Lock</span>
          </button>
        )}
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
    if (!p) queryClient.clear();
    else queryClient.invalidateQueries();
  };

  useEffect(() => {
    const lock = () => { setPin(""); setPinState(""); queryClient.clear(); };
    window.addEventListener("card-tracker:locked", lock);
    if (!pin) return () => window.removeEventListener("card-tracker:locked", lock);
    let lastActivity = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, Math.max(0, 15 * 60 * 1000 - (Date.now() - lastActivity)));
    };
    const activity = () => {
      if (Date.now() - lastActivity >= 15 * 60 * 1000) return lock();
      lastActivity = Date.now();
      schedule();
    };
    const visibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastActivity >= 15 * 60 * 1000) lock();
    };
    schedule();
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("card-tracker:locked", lock);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [pin]);

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

  // A missing backend must never be interpreted as "no password required".
  if (config.isError || !config.data) {
    return (
      <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p>Could not reach Card Tracker. No connection or data changes were confirmed.</p>
        <button type="button" onClick={() => config.refetch()}>Retry</button>
      </div>
    );
  }

  const needsPin = config.data.pinRequired && !pin;

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
