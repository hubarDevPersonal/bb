// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { ThreadListEntry } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadRow, type ThreadRowOptions } from "./ThreadRow";
import { ThreadRowTaskDiffStatsProvider } from "./threadRowTaskDiffContext";
import { TooltipProvider } from "@bb/shared-ui/tooltip";

vi.mock("@/components/thread/ThreadActionsMenu", () => ({
  ThreadActionsContextMenu: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ThreadActionsMenu: () => null,
  ThreadArchiveQuickAction: () => null,
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    renameThread: vi.fn(),
  }),
}));

function createThread(
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id: "thr_test",
    projectId: "proj_test",
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
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
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

const DEFAULT_OPTIONS: ThreadRowOptions = {
  kind: "default",
  depth: 1,
  isCompact: false,
};

function renderThreadRow(
  thread: ThreadListEntry,
  { visible }: { visible: boolean },
) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <ThreadRowTaskDiffStatsProvider value={visible}>
          <ThreadRow
            projectId={thread.projectId}
            thread={thread}
            crossProjectId={null}
            isActive={false}
            hasComposerDraft={false}
            options={DEFAULT_OPTIONS}
          />
        </ThreadRowTaskDiffStatsProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("ThreadRow task diff stats", () => {
  it("shows +N -M when visible and the thread has changed files", () => {
    renderThreadRow(
      createThread({
        taskDiffStats: { changedFiles: 2, insertions: 12, deletions: 3 },
      }),
      { visible: true },
    );
    expect(screen.getByText("+12")).not.toBeNull();
    expect(screen.getByText("−3")).not.toBeNull();
  });

  it("hides the summary when the context marks it not visible", () => {
    renderThreadRow(
      createThread({
        taskDiffStats: { changedFiles: 2, insertions: 12, deletions: 3 },
      }),
      { visible: false },
    );
    expect(screen.queryByText("+12")).toBeNull();
  });

  it("hides the summary when there are no changed files", () => {
    renderThreadRow(
      createThread({
        taskDiffStats: { changedFiles: 0, insertions: 0, deletions: 0 },
      }),
      { visible: true },
    );
    expect(screen.queryByText(/^\+/)).toBeNull();
  });

  it("hides the summary when taskDiffStats is null", () => {
    renderThreadRow(createThread({ taskDiffStats: null }), { visible: true });
    expect(screen.queryByText(/^\+/)).toBeNull();
  });
});
