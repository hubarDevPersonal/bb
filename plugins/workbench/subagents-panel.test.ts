import { describe, expect, it } from "vitest";
import {
  formatSubagentRelativeTime,
  paletteColorForName,
  SUBAGENT_PALETTE_COLORS,
} from "./subagents-panel.js";

describe("paletteColorForName", () => {
  it("is stable across calls for the same name", () => {
    expect(paletteColorForName("Investigate flaky test")).toBe(
      paletteColorForName("Investigate flaky test"),
    );
  });

  it("only ever returns a palette color", () => {
    for (const name of ["a", "bb", "ccc", "delegated worker", "Fix ENG-42"]) {
      expect(SUBAGENT_PALETTE_COLORS).toContain(paletteColorForName(name));
    }
  });

  it("spreads a handful of distinct names across more than one color", () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
    const colors = new Set(names.map(paletteColorForName));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("formatSubagentRelativeTime", () => {
  const now = Date.parse("2026-09-18T12:00:00.000Z");

  it("reports just under a minute as now", () => {
    expect(formatSubagentRelativeTime(now - 30_000, now)).toBe("now");
  });

  it("reports minutes", () => {
    expect(formatSubagentRelativeTime(now - 5 * 60_000, now)).toBe("5m");
  });

  it("reports hours", () => {
    expect(formatSubagentRelativeTime(now - 3 * 3_600_000, now)).toBe("3h");
  });

  it("reports days", () => {
    expect(formatSubagentRelativeTime(now - 2 * 86_400_000, now)).toBe("2d");
  });

  it("reports weeks", () => {
    expect(formatSubagentRelativeTime(now - 14 * 86_400_000, now)).toBe("2w");
  });
});
