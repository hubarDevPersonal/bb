// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { makeSidebarThread } from "../model/fixtures.js";
import { sidebarCollapsedStateGroupsAtom } from "../preferences/atoms.js";

installTestPluginRuntime();
const { StateModeSections } = await import("./ProjectList.js");

function Harness({
  store,
  children,
}: {
  store: ReturnType<typeof createStore>;
  children: ReactNode;
}) {
  return <JotaiProvider store={store}>{children}</JotaiProvider>;
}

function renderStateMode(
  store: ReturnType<typeof createStore>,
  threads: SidebarThread[],
  effectivePinnedThreadIds: ReadonlySet<string> = new Set(),
) {
  return renderSlot(
    { component: Harness },
    {
      store,
      children: (
        <TooltipProvider>
          <StateModeSections
            threads={threads}
            draftThreadIds={new Set()}
            effectivePinnedThreadIds={effectivePinnedThreadIds}
            showPinnedSection={false}
            pinnedSection={{ label: "Pinned", content: null }}
            threadsSection={{ label: "Threads" }}
            collapsedSectionIds={new Set()}
            collapsedThreadIds={new Set()}
            collapsedEnvironmentIds={new Set()}
            compareThreads={() => 0}
            onToggleCollapsed={vi.fn()}
            onToggleThreadCollapsed={vi.fn()}
            onToggleEnvironmentCollapsed={vi.fn()}
          />
        </TooltipProvider>
      ),
    },
    { sidebarThreads: { threads } },
  );
}

const pendingThread = makeSidebarThread({
  id: "thr_pending",
  title: "Needs approval",
  hasPendingInteraction: true,
});
const runningThread = makeSidebarThread({
  id: "thr_running",
  title: "Still working",
  status: "active",
  runtimeStatus: "active",
  lastReadAt: 1,
});
const doneThread = makeSidebarThread({
  id: "thr_done",
  title: "Finished task",
  lastReadAt: 1,
  experimental_taskDiffStats: {
    changedFiles: 3,
    insertions: 1234,
    deletions: 56,
  },
});
const quietThread = makeSidebarThread({
  id: "thr_quiet",
  title: "Nothing changed",
  lastReadAt: 1,
});

afterEach(() => {
  cleanup();
});

describe("StateModeSections", () => {
  it("groups threads into Action needed, Running, and Done in that order", () => {
    renderStateMode(createStore(), [
      doneThread,
      quietThread,
      runningThread,
      pendingThread,
    ]);

    const headings = ["Action needed", "Running", "Done"].map((label) =>
      screen.getByText(label),
    );
    for (let index = 1; index < headings.length; index += 1) {
      const previous = headings[index - 1];
      const current = headings[index];
      expect(
        previous!.compareDocumentPosition(current!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(screen.queryByText("Nothing changed")).toBeNull();
  });

  it("shows task diff stats on rows in state mode", () => {
    renderStateMode(createStore(), [doneThread]);

    const badge = screen.getByLabelText("1234 lines added, 56 lines removed");
    expect(within(badge).getByText("+1,234")).toBeTruthy();
    expect(within(badge).getByText("−56")).toBeTruthy();
  });

  it("keeps pinned threads out of the state groups", () => {
    renderStateMode(createStore(), [pendingThread], new Set(["thr_pending"]));

    expect(screen.queryByText("Action needed")).toBeNull();
  });

  it("persists a collapsed group in the synced preference", () => {
    const store = createStore();
    renderStateMode(store, [pendingThread]);

    fireEvent.click(screen.getByRole("button", { name: /Action needed/ }));

    expect(store.get(sidebarCollapsedStateGroupsAtom)).toEqual([
      "action-needed",
    ]);
  });
});
