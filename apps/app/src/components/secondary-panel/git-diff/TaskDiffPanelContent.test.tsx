// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type {
  EnvironmentDiffFilesResponse,
  ThreadTaskDiffResponse,
} from "@bb/server-contract";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  environmentDiffFilesQueryKey,
  threadTaskDiffQueryKey,
} from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { TaskDiffPanelContent } from "./TaskDiffPanelContent";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: { diffFiles: vi.fn() },
    threads: { taskDiff: vi.fn() },
  },
}));

vi.mock("@pierre/diffs/react", async () => {
  const React = await import("react");
  return {
    File: () => null,
    VirtualizerContext: React.createContext(undefined),
    useWorkerPool: () => null,
  };
});

const THREAD_ID = "thr-1";
const ENVIRONMENT_ID = "env-1";
const TASK_DIFF_TARGET: WorkspaceDiffTarget = {
  type: "all",
  mergeBaseBranch: "main",
};

const taskDiffResponse: ThreadTaskDiffResponse = {
  outcome: "available",
  threadId: THREAD_ID,
  environmentId: ENVIRONMENT_ID,
  kind: "branch",
  target: TASK_DIFF_TARGET,
  baseBranch: "main",
  branchName: "feature",
  stats: { changedFiles: 1, insertions: 2, deletions: 1 },
  canApplyLocally: false,
};

const diffFilesResponse: EnvironmentDiffFilesResponse = {
  outcome: "available",
  files: [
    {
      path: "src/index.ts",
      previousPath: null,
      changeKind: "modified",
      additions: 2,
      deletions: 1,
      binary: false,
      origin: "tracked",
      loadMode: "auto",
    },
  ],
  truncated: false,
  shortstat: "",
  mergeBaseRef: "main",
  initialPatches: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskDiffPanelContent", () => {
  it("renders the diff for the task-diff query's target, not a selectable target", async () => {
    vi.mocked(sdk.threads.taskDiff).mockResolvedValue(taskDiffResponse);
    vi.mocked(sdk.environments.diffFiles).mockResolvedValue(diffFilesResponse);
    const { wrapper: Wrapper } = createQueryClientTestHarness();

    render(
      <Wrapper>
        <TooltipProvider delayDuration={0}>
          <TaskDiffPanelContent threadId={THREAD_ID} isPanelOpen />
        </TooltipProvider>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(sdk.environments.diffFiles).toHaveBeenCalledTimes(1);
    });
    expect(sdk.environments.diffFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        environmentId: ENVIRONMENT_ID,
        mergeBaseBranch: "main",
        target: "all",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("0 / 1 files")).not.toBeNull();
    });
    expect(screen.getByText("+2")).not.toBeNull();
    expect(screen.getByText("−1")).not.toBeNull();
  });

  it("shows the file count immediately from a warm cache", async () => {
    vi.mocked(sdk.threads.taskDiff).mockResolvedValue(taskDiffResponse);
    vi.mocked(sdk.environments.diffFiles).mockResolvedValue(diffFilesResponse);
    const { wrapper: Wrapper, queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(
      threadTaskDiffQueryKey(THREAD_ID),
      taskDiffResponse,
    );
    queryClient.setQueryData(
      environmentDiffFilesQueryKey(ENVIRONMENT_ID, "all", "main"),
      diffFilesResponse,
    );

    render(
      <Wrapper>
        <TooltipProvider delayDuration={0}>
          <TaskDiffPanelContent threadId={THREAD_ID} isPanelOpen />
        </TooltipProvider>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("0 / 1 files")).not.toBeNull();
    });
  });
});
