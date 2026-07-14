// Sync connection-state singleton — same module-level-state + listener-Set
// + useSyncExternalStore shape as lib/crypto/index.ts's lock-state
// singleton, for a 3-value status string instead of a boolean. Plan 05-04's
// TopBar sync-status dot consumes useSyncStatus(); sync.ts drives the
// transitions (connected on WS open, reconnecting on unintentional close,
// offline from stopSync).
import { useSyncExternalStore } from "react";

export type SyncStatus = "connected" | "reconnecting" | "offline";

let currentStatus: SyncStatus = "offline";
const statusListeners = new Set<() => void>();

export function setSyncStatus(status: SyncStatus): void {
  if (status === currentStatus) {
    return;
  }
  currentStatus = status;
  statusListeners.forEach((listener) => listener());
}

export function getSyncStatus(): SyncStatus {
  return currentStatus;
}

export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

/**
 * React hook wrapper over the sync-status singleton via
 * useSyncExternalStore. Third arg is a stable "offline" snapshot for any
 * non-browser render path — defensive fallback only (static export, no
 * real SSR), mirroring useIsUnlocked's shape.
 */
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSyncStatus, getSyncStatus, () => "offline");
}
