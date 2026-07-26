import { useSyncExternalStore } from "react";
import { getReaderState, subscribeReader } from "@/state/reader";
import { getSession, subscribeSession } from "@/state/session";

// React adapters over the hand-rolled observables. The stores stay the single
// source of truth; every page reads the same state.
export function useSession(): ReturnType<typeof getSession> {
  return useSyncExternalStore(subscribeSession, getSession);
}

export function useReaderState(): ReturnType<typeof getReaderState> {
  return useSyncExternalStore(subscribeReader, getReaderState);
}
