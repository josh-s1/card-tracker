import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Lock } from "lucide-react";
import { apiJson, setPin, LockedError } from "@/lib/api";

export default function UnlockPage({ onUnlocked }: { onUnlocked: (p: string) => void }) {
  const [pin, setLocal] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      // A real API call with the PIN; success means the pin is right.
      setPin(pin);
      await apiJson("/api/unlock", { method: "POST" });
      onUnlocked(pin);
    } catch (err) {
      setPin("");
      if (err instanceof LockedError) {
        setError("Incorrect access code. Try again.");
      } else {
        setError(err instanceof Error ? err.message : "Unable to unlock. Try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#F2F4F6] px-6">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-[0_8px_30px_rgba(20,33,43,0.08)]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1F3A5F] text-white">
            <Lock size={20} />
          </div>
          <h1 className="text-lg font-semibold">Card Tracker is locked</h1>
          <p className="text-sm text-[#68757F]">
            Enter your access code to see your cards.
          </p>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="Access code"
            value={pin}
            onChange={(e) => setLocal(e.target.value)}
            className="text-center text-lg tracking-[0.3em]"
            data-testid="input-pin"
            autoFocus
          />
          {error && <p className="text-center text-sm text-[#B23B3B]">{error}</p>}
          <Button
            type="submit"
            disabled={busy || !pin}
            className="w-full bg-[#1F3A5F] hover:bg-[#152B49]"
            data-testid="button-unlock"
          >
            {busy ? "Checking…" : "Unlock"}
          </Button>
        </form>
      </div>
    </div>
  );
}
