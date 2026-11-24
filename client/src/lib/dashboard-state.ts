import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, getShowSamples, subscribeSampleMode } from "./api";
import type { AppState } from "./format";

export const useSampleMode = () => useSyncExternalStore(subscribeSampleMode, getShowSamples);

export function useDashboardState(pin: string) {
  const sample = useSampleMode();
  return useQuery<AppState>({
    queryKey: ["state", pin, sample],
    queryFn: ({ signal }) => api.state(sample, signal),
  });
}
