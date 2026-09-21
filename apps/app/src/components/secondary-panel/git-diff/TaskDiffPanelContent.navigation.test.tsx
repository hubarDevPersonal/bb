// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { WorkspaceDiffTarget } from "@bb/domain";
import type { ThreadTaskDiffResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { TaskDiffPanelContent } from "./TaskDiffPanelContent";

vi.mock("@/lib/sdk", () => ({
  sdk: { threads: { taskDiff: vi.fn() } },
}));

const mockFiles = vi.hoisted(() => [{ path: "a.ts" }, { path: "b.ts" }]);
const gitDiffTabContentSpy = vi.hoisted(() => vi.fn());

vi.mock("../ThreadSecondaryPanelTabContent", async () => {
  const React = await import("react");
  function GitDiffTabContent(props: {
    onFilesChange?: (files: readonly { path: string }[]) => void;
    pendingGitDiffScrollPath?: string | null;
  }) {
    gitDiffTabContentSpy(props);
    React.useEffect(() => {
      props.onFilesChange?.(mockFiles);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement("div", {
      "data-testid": "mock-git-diff-content",
      "data-scroll-to-path": props.pendingGitDiffScrollPath ?? "",
    });
  }
  return { GitDiffTabContent };
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
  stats: { changedFiles: 2, insertions: 3, deletions: 1 },
  canApplyLocally: false,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskDiffPanelContent navigation", () => {
  it("passes the next file's path as pendingGitDiffScrollPath when Next is clicked", async () => {
    vi.mocked(sdk.threads.taskDiff).mockResolvedValue(taskDiffResponse);
    const { wrapper: Wrapper } = createQueryClientTestHarness();

    render(
      <Wrapper>
        <TooltipProvider delayDuration={0}>
          <TaskDiffPanelContent
            threadId={THREAD_ID}
            isPanelOpen
            fileFilter={null}
          />
        </TooltipProvider>
      </Wrapper>,
    );

    await waitFor(() => {
      expect(screen.getByText("0 / 2 files")).not.toBeNull();
    });
    expect(
      screen.getByTestId("mock-git-diff-content").dataset.scrollToPath,
    ).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Next changed file" }));

    await waitFor(() => {
      expect(screen.getByText("1 / 2 files")).not.toBeNull();
    });
    expect(
      screen.getByTestId("mock-git-diff-content").dataset.scrollToPath,
    ).toBe("a.ts");
  });
});
