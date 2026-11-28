import { describe, expect, it } from "vitest";
import {
  isFestiveActive,
  isFestiveSeason,
  nextBoundary,
  parseMode,
} from "./season";

const at = (month: number, day: number, hour = 12) =>
  new Date(2026, month - 1, day, hour, 0, 0, 0);

describe("isFestiveSeason", () => {
  it.each([
    [at(12, 14, 23), false],
    [at(12, 15, 0), true],
    [at(12, 31, 23), true],
    [at(1, 1, 0), true],
    [at(1, 14, 23), true],
    [at(1, 15, 0), false],
    [at(7, 1), false],
  ])("%s → %s", (date, expected) => {
    expect(isFestiveSeason(date)).toBe(expected);
  });
});

describe("isFestiveActive", () => {
  it("auto follows the season", () => {
    expect(isFestiveActive("auto", at(12, 14))).toBe(false);
    expect(isFestiveActive("auto", at(12, 15))).toBe(true);
    expect(isFestiveActive("auto", at(1, 14))).toBe(true);
    expect(isFestiveActive("auto", at(1, 15))).toBe(false);
  });

  it("on and off override the season both ways", () => {
    expect(isFestiveActive("on", at(7, 1))).toBe(true);
    expect(isFestiveActive("off", at(12, 25))).toBe(false);
    expect(isFestiveActive("auto", at(11, 28), true)).toBe(true);
    expect(isFestiveActive("off", at(11, 28), true)).toBe(false);
  });

  it("treats unknown stored values as auto", () => {
    expect(parseMode(null)).toBe("auto");
    expect(parseMode("always")).toBe("auto");
    expect(parseMode("on")).toBe("on");
    expect(parseMode("off")).toBe("off");
  });
});

describe("nextBoundary", () => {
  it("is the next local midnight on ordinary days", () => {
    expect(nextBoundary(at(12, 14, 18))).toEqual(new Date(2026, 11, 15));
    expect(nextBoundary(at(1, 14, 23))).toEqual(new Date(2026, 0, 15));
  });

  it("stops at 23:00 on Dec 31, then at midnight", () => {
    expect(nextBoundary(at(12, 31, 10))).toEqual(new Date(2026, 11, 31, 23));
    expect(nextBoundary(at(12, 31, 23))).toEqual(new Date(2027, 0, 1));
  });
});
