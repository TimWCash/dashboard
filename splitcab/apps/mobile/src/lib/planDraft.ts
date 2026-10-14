import type { Place, TimeMode } from '@splitcab/core';
import { useSyncExternalStore } from 'react';

// The trip being planned. Shared between the plan screen and the place search screen it opens.
export interface PlanDraft {
  origin: Place | null;
  destination: Place | null;
  timeMode: TimeMode;
  time: Date;
  flexMin: number;
  seats: number;
}

function defaultTime() {
  const quarter = 15 * 60_000;
  return new Date(Math.ceil((Date.now() + 60 * 60_000) / quarter) * quarter);
}

let draft: PlanDraft = { origin: null, destination: null, timeMode: 'depart', time: defaultTime(), flexMin: 30, seats: 1 };
const listeners = new Set<() => void>();

export function updateDraft(patch: Partial<PlanDraft>) {
  draft = { ...draft, ...patch };
  listeners.forEach((l) => l());
}

export function resetDraft() {
  updateDraft({ origin: null, destination: null, timeMode: 'depart', time: defaultTime(), flexMin: 30, seats: 1 });
}

export function usePlanDraft(): PlanDraft {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => draft,
    () => draft,
  );
}
