
export const PLANNER_COOLDOWN_MS = 3 * 60 * 60_000;
const EMPTY_BASE_MS = 24 * 60 * 60_000;
const EMPTY_MAX_MS = 7 * 24 * 60 * 60_000;

export function plannerCooldownMs(emptyRuns: number): number {
  if (emptyRuns <= 0) return PLANNER_COOLDOWN_MS;
  return Math.min(EMPTY_MAX_MS, EMPTY_BASE_MS * 2 ** (emptyRuns - 1));
}
