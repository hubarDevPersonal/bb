import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import { buildStateThreadGroups } from "./stateThreadGroups";

function thread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return {
    id: "thr_1",
    projectId: "proj_1",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 0,
    latestAttentionAt: 0,
    createdAt: 1,
    updatedAt: 2,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: {
      displayStatus: "idle",
      hostReconnectGraceExpiresAt: null,
    },
    taskDiffStats: null,
    ...overrides,
  };
}

describe("buildStateThreadGroups", () => {
  it("puts a thread with a pending interaction in action needed", () => {
    const groups = buildStateThreadGroups([
      thread({ id: "thr_pending", hasPendingInteraction: true }),
    ]);
    expect(groups).toEqual([
      {
        key: "action-needed",
        label: "Action needed",
        threads: [expect.objectContaining({ id: "thr_pending" })],
      },
    ]);
  });

  it("puts an unread idle thread in action needed", () => {
    const groups = buildStateThreadGroups([
      thread({ id: "thr_unread", status: "idle", latestAttentionAt: 5 }),
    ]);
    expect(groups).toEqual([
      {
        key: "action-needed",
        label: "Action needed",
        threads: [expect.objectContaining({ id: "thr_unread" })],
      },
    ]);
  });

  it("does not treat a child thread's unread status as action needed", () => {
    const groups = buildStateThreadGroups([
      thread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        status: "idle",
        latestAttentionAt: 5,
      }),
    ]);
    expect(groups).toEqual([]);
  });

  it("puts a running thread in running", () => {
    const groups = buildStateThreadGroups([
      thread({
        id: "thr_active",
        status: "active",
        runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
      }),
    ]);
    expect(groups).toEqual([
      {
        key: "running",
        label: "Running",
        threads: [expect.objectContaining({ id: "thr_active" })],
      },
    ]);
  });

  it("puts an idle thread with changed files in done", () => {
    const groups = buildStateThreadGroups([
      thread({
        id: "thr_done",
        taskDiffStats: { changedFiles: 2, insertions: 3, deletions: 1 },
      }),
    ]);
    expect(groups).toEqual([
      {
        key: "done",
        label: "Done",
        threads: [expect.objectContaining({ id: "thr_done" })],
      },
    ]);
  });

  it("omits an idle thread with no diff and no pending interaction", () => {
    const groups = buildStateThreadGroups([thread({ id: "thr_idle" })]);
    expect(groups).toEqual([]);
  });

  it("orders groups action needed, running, done and skips empty groups", () => {
    const groups = buildStateThreadGroups([
      thread({
        id: "thr_done",
        taskDiffStats: { changedFiles: 1, insertions: 1, deletions: 0 },
      }),
      thread({
        id: "thr_pending",
        hasPendingInteraction: true,
      }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["action-needed", "done"]);
  });

  it("gives a pending interaction priority over a running status", () => {
    const groups = buildStateThreadGroups([
      thread({
        id: "thr_both",
        hasPendingInteraction: true,
        status: "active",
        runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
      }),
    ]);
    expect(groups).toEqual([
      {
        key: "action-needed",
        label: "Action needed",
        threads: [expect.objectContaining({ id: "thr_both" })],
      },
    ]);
  });
});
