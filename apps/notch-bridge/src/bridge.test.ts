import { describe, expect, it } from "vitest";
import type { PendingInteraction } from "@bb/domain";
import { toHookEvent, toResolution, type ThreadSnapshot } from "./bridge.js";

const thread: ThreadSnapshot = { id: "thr_1", title: "t", status: "active", attention: true };

const base = {
  id: "pint_1",
  threadId: "thr_1",
  status: "pending" as const,
  statusReason: null,
  createdAt: 0,
  resolvedAt: null,
};

function approval(subject: Record<string, unknown>, availableDecisions: string[]): PendingInteraction {
  return {
    ...base,
    turnId: null,
    origin: { kind: "provider", providerId: "claude-code", providerRequestId: "r" },
    payload: { kind: "approval", subject, reason: "why", availableDecisions },
  } as unknown as PendingInteraction;
}

function question(): PendingInteraction {
  return {
    ...base,
    turnId: null,
    origin: { kind: "provider", providerId: "claude-code", providerRequestId: "r" },
    payload: {
      kind: "user_question",
      questions: [
        {
          id: "q1",
          prompt: "Какой цвет?",
          multiSelect: false,
          allowFreeText: true,
          options: [
            { value: "red", label: "Красный" },
            { value: "blue", label: "Синий" },
          ],
        },
      ],
    },
  } as unknown as PendingInteraction;
}

describe("toHookEvent", () => {
  it("maps a command approval to a Bash permission request", () => {
    const event = toHookEvent(
      approval({ kind: "command", itemId: "i", command: "rm -rf build", cwd: null, actions: [], sessionGrant: null }, ["allow_once", "deny"]),
      thread,
    );
    expect(event).toMatchObject({ id: "pint_1", type: "PermissionRequest", tool_name: "Bash", tool_input: "rm -rf build", session_id: "thr_1" });
  });

  it("maps a user question to an AskUserQuestion poll with option labels", () => {
    expect(toHookEvent(question(), thread)).toMatchObject({
      type: "PermissionRequest",
      tool_name: "AskUserQuestion",
      message: "Какой цвет?",
      choices: ["Красный", "Синий"],
    });
  });
});

describe("toResolution", () => {
  it("turns approve/always_allow/deny into bb approval decisions", () => {
    const withSession = approval({ kind: "command", itemId: "i", command: "ls", cwd: null, actions: [], sessionGrant: null }, ["allow_once", "allow_for_session", "deny"]);
    expect(toResolution(withSession, { id: "pint_1", action: "approve" })).toEqual({ decision: "allow_once", grantedPermissions: null });
    expect(toResolution(withSession, { id: "pint_1", action: "always_allow" })).toEqual({ decision: "allow_for_session", grantedPermissions: null });
    expect(toResolution(withSession, { id: "pint_1", action: "deny" })).toEqual({ decision: "deny" });
  });

  it("downgrades always_allow when the session grant is not offered", () => {
    const onceOnly = approval({ kind: "command", itemId: "i", command: "ls", cwd: null, actions: [], sessionGrant: null }, ["allow_once", "deny"]);
    expect(toResolution(onceOnly, { id: "pint_1", action: "always_allow" })).toEqual({ decision: "allow_once", grantedPermissions: null });
  });

  it("maps a chosen label back to the option value, and unknown text to free text", () => {
    expect(toResolution(question(), { id: "pint_1", action: "approve", message: "Синий" })).toEqual({
      kind: "user_answer",
      answers: { q1: { selected: ["blue"] } },
    });
    expect(toResolution(question(), { id: "pint_1", action: "approve", message: "фиолетовый" })).toEqual({
      kind: "user_answer",
      answers: { q1: { selected: [], freeText: "фиолетовый" } },
    });
    expect(toResolution(question(), { id: "pint_1", action: "deny" })).toBeNull();
  });
});
