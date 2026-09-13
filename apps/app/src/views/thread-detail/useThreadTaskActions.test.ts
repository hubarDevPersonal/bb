import { describe, expect, it } from "vitest";
import type { ThreadTaskDiffResponse } from "@bb/server-contract";
import {
  deriveThreadTaskActionsAvailability,
  type ThreadTaskActionsAvailability,
} from "./useThreadTaskActions";

function makeAvailableTaskDiff(
  overrides: Partial<
    Extract<ThreadTaskDiffResponse, { outcome: "available" }>
  > = {},
): ThreadTaskDiffResponse {
  return {
    baseBranch: "main",
    branchName: "bb/feature",
    canApplyLocally: true,
    environmentId: "env_1",
    kind: "branch",
    outcome: "available",
    stats: { changedFiles: 1, deletions: 1, insertions: 1 },
    target: { type: "all", mergeBaseBranch: "main" },
    threadId: "thr_1",
    ...overrides,
  };
}

function derive(
  overrides: Partial<
    Parameters<typeof deriveThreadTaskActionsAvailability>[0]
  > = {},
): ThreadTaskActionsAvailability {
  return deriveThreadTaskActionsAvailability({
    archivedAt: null,
    displayStatus: "idle",
    taskDiff: makeAvailableTaskDiff(),
    workspaceClean: true,
    ...overrides,
  });
}

describe("deriveThreadTaskActionsAvailability", () => {
  it("hides both actions when the thread is archived", () => {
    expect(derive({ archivedAt: Date.now() })).toEqual({
      canApply: false,
      canReview: false,
    });
  });

  it("hides both actions when the task diff is not loaded yet", () => {
    expect(derive({ taskDiff: undefined })).toEqual({
      canApply: false,
      canReview: false,
    });
  });

  it("hides both actions when the task diff is not applicable", () => {
    expect(
      derive({
        taskDiff: { outcome: "not_applicable", reason: "no_environment" },
      }),
    ).toEqual({ canApply: false, canReview: false });
  });

  it("hides both actions when there are no changed files", () => {
    expect(
      derive({
        taskDiff: makeAvailableTaskDiff({
          stats: { changedFiles: 0, deletions: 0, insertions: 0 },
        }),
      }),
    ).toEqual({ canApply: false, canReview: false });
  });

  it("hides both actions while the thread is not idle", () => {
    expect(derive({ displayStatus: "active" })).toEqual({
      canApply: false,
      canReview: false,
    });
  });

  it("allows review but not apply when canApplyLocally is false", () => {
    expect(
      derive({ taskDiff: makeAvailableTaskDiff({ canApplyLocally: false }) }),
    ).toEqual({ canApply: false, canReview: true });
  });

  it("allows review but not apply when the workspace is dirty or its status is unknown", () => {
    expect(derive({ workspaceClean: false })).toEqual({
      canApply: false,
      canReview: true,
    });
  });

  it("allows both review and apply when changes exist and can be applied locally", () => {
    expect(derive()).toEqual({ canApply: true, canReview: true });
  });
});
