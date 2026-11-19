import { describe, expect, it } from "vitest";
import { PLANNER_COOLDOWN_MS, plannerCooldownMs } from "./planner.js";

const HOUR = 60 * 60_000;

describe("plannerCooldownMs", () => {
  it("replans every three hours while planning finds work", () => {
    expect(plannerCooldownMs(0)).toBe(PLANNER_COOLDOWN_MS);
    expect(PLANNER_COOLDOWN_MS).toBe(3 * HOUR);
  });

  it("waits a day after an empty run and doubles up to a week", () => {
    expect(plannerCooldownMs(1)).toBe(24 * HOUR);
    expect(plannerCooldownMs(2)).toBe(48 * HOUR);
    expect(plannerCooldownMs(3)).toBe(96 * HOUR);
    expect(plannerCooldownMs(4)).toBe(168 * HOUR);
    expect(plannerCooldownMs(50)).toBe(168 * HOUR);
  });
});
