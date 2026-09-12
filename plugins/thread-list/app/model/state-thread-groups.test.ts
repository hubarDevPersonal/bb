import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "./fixtures.js";
import { buildStateThreadGroups } from "./state-thread-groups.js";

describe("buildStateThreadGroups", () => {
  it("puts a thread with a pending interaction in action needed", () => {
    const groups = buildStateThreadGroups([
      makeSidebarThread({ id: "thr_pending", hasPendingInteraction: true }),
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
      makeSidebarThread({ id: "thr_unread", latestAttentionAt: 5 }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["action-needed"]);
  });

  it("does not treat a child thread's unread status as action needed", () => {
    const groups = buildStateThreadGroups([
      makeSidebarThread({
        id: "thr_child",
        parentThreadId: "thr_parent",
        latestAttentionAt: 5,
      }),
    ]);
    expect(groups).toEqual([]);
  });

  it("puts a running thread in running", () => {
    const groups = buildStateThreadGroups([
      makeSidebarThread({
        id: "thr_active",
        status: "active",
        runtimeStatus: "active",
        lastReadAt: 1,
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

  it("puts a read idle thread with changed files in done", () => {
    const groups = buildStateThreadGroups([
      makeSidebarThread({
        id: "thr_done",
        lastReadAt: 1,
        experimental_taskDiffStats: {
          changedFiles: 2,
          insertions: 3,
          deletions: 1,
        },
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

  it("omits a read idle thread with no diff and no pending interaction", () => {
    const groups = buildStateThreadGroups([
      makeSidebarThread({ id: "thr_idle", lastReadAt: 1 }),
    ]);
    expect(groups).toEqual([]);
  });

  it("orders groups action needed, running, done and skips empty groups", () => {
    const groups = buildStateThreadGroups([
      makeSidebarThread({
        id: "thr_done",
        lastReadAt: 1,
        experimental_taskDiffStats: {
          changedFiles: 1,
          insertions: 1,
          deletions: 0,
        },
      }),
      makeSidebarThread({ id: "thr_pending", hasPendingInteraction: true }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["action-needed", "done"]);
  });

  it("gives a pending interaction priority over a running status", () => {
    const groups = buildStateThreadGroups([
      makeSidebarThread({
        id: "thr_both",
        hasPendingInteraction: true,
        status: "active",
        runtimeStatus: "active",
      }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["action-needed"]);
  });
});
