import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  classifyWindow,
  evaluateBudget,
  type ProviderUsageLike,
} from "./budget.js";

const NOW = Date.parse("2026-10-24T10:00:00Z");
const policy = { ...DEFAULT_POLICY, jitterMinMs: 0, jitterMaxMs: 0 };

function usage(
  fiveHour: number,
  weekly: number,
  extra: ProviderUsageLike["windows"] = [],
): ProviderUsageLike {
  return {
    status: "ok",
    windows: [
      { label: "Current session", kind: "five-hour", usedPercent: fiveHour, resetsAt: "2026-10-24T12:30:00Z" },
      { label: "Weekly limit", kind: "weekly", usedPercent: weekly, resetsAt: "2026-10-27T08:00:00Z" },
      ...(extra ?? []),
    ],
  };
}

describe("classifyWindow", () => {
  it("prefers the structured kind", () => {
    expect(classifyWindow({ label: "whatever", kind: "weekly", usedPercent: 1, resetsAt: null })).toBe("weekly");
  });
  it("falls back to the label", () => {
    expect(classifyWindow({ label: "5h window", usedPercent: 1, resetsAt: null })).toBe("five-hour");
    expect(classifyWindow({ label: "Current session", usedPercent: 1, resetsAt: null })).toBe("five-hour");
    expect(classifyWindow({ label: "Weekly limit", usedPercent: 1, resetsAt: null })).toBe("weekly");
    expect(classifyWindow({ label: "Monthly", usedPercent: 1, resetsAt: null })).toBe("other");
  });
});

describe("evaluateBudget", () => {
  it("allows work under both budgets and reports headroom", () => {
    const verdict = evaluateBudget({ usage: usage(40, 50), policy, now: NOW });
    expect(verdict).toEqual({ kind: "ok", headroomPercent: 20 });
  });

  it("blocks at the five-hour budget and resumes at its reset", () => {
    const verdict = evaluateBudget({ usage: usage(60, 10), policy, now: NOW });
    expect(verdict.kind).toBe("blocked");
    if (verdict.kind !== "blocked") return;
    expect(verdict.resumeAt).toBe(Date.parse("2026-10-24T12:30:00Z"));
    expect(verdict.reason).toContain("Current session 60% ≥ 60%");
  });

  it("waits for the later reset when both windows are over", () => {
    const verdict = evaluateBudget({ usage: usage(90, 75), policy, now: NOW });
    expect(verdict.kind).toBe("blocked");
    if (verdict.kind !== "blocked") return;
    expect(verdict.resumeAt).toBe(Date.parse("2026-10-27T08:00:00Z"));
    expect(verdict.exceeded.map((w) => w.windowClass)).toEqual(["five-hour", "weekly"]);
  });

  it("adds jitter after the reset", () => {
    const verdict = evaluateBudget({
      usage: usage(70, 10),
      policy: { ...policy, jitterMinMs: 60_000, jitterMaxMs: 120_000 },
      now: NOW,
      random: 0.5,
    });
    if (verdict.kind !== "blocked") throw new Error("expected blocked");
    expect(verdict.resumeAt).toBe(Date.parse("2026-10-24T12:30:00Z") + 90_000);
  });

  it("raises limits by the hard-stop margin", () => {
    expect(evaluateBudget({ usage: usage(70, 10), policy, now: NOW, marginPercent: 15 }).kind).toBe("ok");
    expect(evaluateBudget({ usage: usage(75, 10), policy, now: NOW, marginPercent: 15 }).kind).toBe("blocked");
  });

  it("never lets a margin push the limit past 100%", () => {
    const verdict = evaluateBudget({
      usage: usage(100, 10),
      policy: { ...policy, fiveHourPercent: 95 },
      now: NOW,
      marginPercent: 15,
    });
    expect(verdict.kind).toBe("blocked");
  });

  it("is conservative when usage is unreadable", () => {
    for (const bad of [null, undefined, { status: "unauthenticated" }]) {
      const verdict = evaluateBudget({ usage: bad, policy, now: NOW });
      expect(verdict.kind).toBe("blocked");
      if (verdict.kind === "blocked") expect(verdict.resumeAt).toBe(NOW + policy.unknownBackoffMs);
    }
  });

  it("applies model-scoped weekly windows only to that model", () => {
    const scoped = usage(10, 10, [
      { label: "Opus", kind: "weekly", model: "opus", usedPercent: 95, resetsAt: "2026-10-26T00:00:00Z" },
    ]);
    expect(evaluateBudget({ usage: scoped, policy, now: NOW, model: "claude-sonnet-5" }).kind).toBe("ok");
    expect(evaluateBudget({ usage: scoped, policy, now: NOW, model: "claude-opus-5" }).kind).toBe("blocked");
    expect(evaluateBudget({ usage: scoped, policy, now: NOW, model: null }).kind).toBe("ok");
  });

  it("falls back to backoff when an exceeded window has no reset time", () => {
    const verdict = evaluateBudget({
      usage: { status: "ok", windows: [{ label: "Current session", kind: "five-hour", usedPercent: 99, resetsAt: null }] },
      policy,
      now: NOW,
    });
    if (verdict.kind !== "blocked") throw new Error("expected blocked");
    expect(verdict.resumeAt).toBe(NOW + policy.unknownBackoffMs);
  });

  it("never resumes in the past", () => {
    const verdict = evaluateBudget({
      usage: { status: "ok", windows: [{ label: "Current session", kind: "five-hour", usedPercent: 99, resetsAt: "2026-10-24T09:00:00Z" }] },
      policy,
      now: NOW,
    });
    if (verdict.kind !== "blocked") throw new Error("expected blocked");
    expect(verdict.resumeAt).toBe(NOW);
  });
});
