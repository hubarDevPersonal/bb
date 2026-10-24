import { describe, expect, it } from "vitest";
import { decide, type Tracked } from "./lifecycle.js";

const NOW = 1_000_000_000;
const options = { now: NOW, maxAttempts: 3, staleMs: 45 * 60_000 };

function tracked(patch: Partial<Tracked> = {}): Tracked {
  return {
    taskId: "t1",
    taskKey: "FUND-1",
    projectId: "p",
    kind: "code",
    phase: "work",
    threadId: "thr_1",
    attempts: 0,
    startedAt: NOW - 60_000,
    phaseStartedAt: NOW - 60_000,
    lastNudgeAt: null,
    parkedAt: null,
    ...patch,
  };
}

const running = { status: "active", queuedMessageCount: 0 };
const idle = { status: "idle", queuedMessageCount: 0 };

describe("decide", () => {
  it("waits while the worker is busy", () => {
    expect(decide(tracked(), { status: "in_progress" }, running, options)).toEqual({ kind: "none" });
  });

  it("sends finished work to the verifier", () => {
    expect(decide(tracked(), { status: "in_review" }, idle, options)).toEqual({ kind: "verify" });
  });

  it("verifies even when a worker skipped review and marked done", () => {
    expect(decide(tracked(), { status: "done" }, idle, options)).toEqual({ kind: "verify" });
  });

  it("completes when the verifier marks done", () => {
    expect(decide(tracked({ phase: "verify" }), { status: "done" }, idle, options)).toEqual({ kind: "complete" });
  });

  it("completes planner tasks without verification", () => {
    expect(decide(tracked({ kind: "planner" }), { status: "in_review" }, idle, options)).toEqual({ kind: "complete" });
  });

  it("retries when the verifier rejects", () => {
    expect(decide(tracked({ phase: "verify" }), { status: "todo" }, idle, options)).toEqual({
      kind: "retry",
      reason: "проверка не прошла",
    });
  });

  it("gives up after the last attempt", () => {
    const action = decide(tracked({ phase: "verify", attempts: 2 }), { status: "todo" }, idle, options);
    expect(action.kind).toBe("give-up");
  });

  it("lets a human take the task back", () => {
    expect(decide(tracked(), { status: "backlog" }, idle, options).kind).toBe("release");
    expect(decide(tracked(), { status: "canceled" }, idle, options).kind).toBe("release");
    expect(decide(tracked(), null, idle, options).kind).toBe("release");
  });

  it("treats a crashed thread as a failed attempt", () => {
    expect(decide(tracked(), { status: "in_progress" }, { status: "error", queuedMessageCount: 0 }, options).kind).toBe("retry");
  });

  it("leaves a thread alone while a retry or continue is queued for the window", () => {
    expect(decide(tracked(), { status: "in_progress" }, { status: "error", queuedMessageCount: 1 }, options)).toEqual({ kind: "none" });
    const old = tracked({ phaseStartedAt: NOW - 10 * 60 * 60_000 });
    expect(decide(old, { status: "in_progress" }, { status: "idle", queuedMessageCount: 1 }, options)).toEqual({ kind: "none" });
  });

  it("nudges an idle thread that stopped short of the contract", () => {
    const old = tracked({ phaseStartedAt: NOW - 50 * 60_000 });
    expect(decide(old, { status: "in_progress" }, idle, options)).toEqual({ kind: "nudge" });
  });

  it("does not nudge again right after a nudge", () => {
    const old = tracked({ phaseStartedAt: NOW - 5 * 60 * 60_000, lastNudgeAt: NOW - 10 * 60_000 });
    expect(decide(old, { status: "in_progress" }, idle, options)).toEqual({ kind: "none" });
  });

  it("retries when the thread is gone", () => {
    expect(decide(tracked(), { status: "in_progress" }, null, options).kind).toBe("retry");
  });
});
