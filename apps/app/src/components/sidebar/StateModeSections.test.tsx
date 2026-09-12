// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { StateModeSections } from "./ProjectList";

vi.mock("@/components/thread/ThreadActionsMenu", () => ({
  ThreadActionsContextMenu: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  ThreadActionsMenu: () => null,
  ThreadArchiveQuickAction: () => null,
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({ renameThread: vi.fn() }),
}));

function makeThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
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

function renderStateMode(
  threads: ThreadListEntry[],
  { showPinnedSection = false } = {},
) {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <StateModeSections
          threads={threads}
          draftThreadIds={new Set()}
          effectivePinnedThreadIds={new Set()}
          showPinnedSection={showPinnedSection}
          pinnedSection={{ label: "Pinned", content: null }}
          collapsedSectionIds={new Set()}
          collapsedThreadIds={new Set()}
          collapsedEnvironmentIds={new Set()}
          compareThreads={() => 0}
          onToggleCollapsed={vi.fn()}
          onToggleThreadCollapsed={vi.fn()}
          onToggleEnvironmentCollapsed={vi.fn()}
          threadsSection={{
            label: "Threads",
            actions: (
              <button type="button" aria-label="Sidebar display options">
                Display options
              </button>
            ),
            actionsOpen: false,
          }}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("StateModeSections", () => {
  it("renders only the sections with matching threads, in order", () => {
    renderStateMode([
      makeThread({
        id: "thr_pending",
        title: "Needs a reply",
        hasPendingInteraction: true,
      }),
      makeThread({
        id: "thr_done",
        title: "Finished work",
        taskDiffStats: { changedFiles: 1, insertions: 4, deletions: 1 },
      }),
    ]);

    expect(screen.getByText("Action needed")).not.toBeNull();
    expect(screen.getByText("Done")).not.toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.getByText("Needs a reply")).not.toBeNull();
    expect(screen.getByText("Finished work")).not.toBeNull();
  });

  it("shows the task diff summary on rows with changed files", () => {
    renderStateMode([
      makeThread({
        id: "thr_done",
        title: "Finished work",
        taskDiffStats: { changedFiles: 1, insertions: 4, deletions: 1 },
      }),
    ]);

    expect(screen.getByText("+4")).not.toBeNull();
    expect(screen.getByText("−1")).not.toBeNull();
  });

  it("omits a thread that matches no bucket", () => {
    renderStateMode([makeThread({ id: "thr_idle", title: "Idle thread" })]);

    expect(screen.queryByText("Idle thread")).toBeNull();
    expect(screen.queryByText("Action needed")).toBeNull();
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("Done")).toBeNull();
  });

  it("keeps the display-options trigger reachable when nothing is pinned and no thread matches a bucket", () => {
    renderStateMode([makeThread({ id: "thr_idle", title: "Idle thread" })], {
      showPinnedSection: false,
    });

    expect(
      screen.getByRole("button", { name: "Sidebar display options" }),
    ).not.toBeNull();
    expect(screen.getByText("Threads")).not.toBeNull();
  });
});
