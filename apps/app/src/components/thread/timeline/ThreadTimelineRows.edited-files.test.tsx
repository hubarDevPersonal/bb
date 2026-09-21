// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import type { TimelineRow } from "@bb/server-contract";
import {
  conversationRow,
  fileChangeRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import { ThreadTimelineRows } from "./ThreadTimelineRows";

const THREAD_ID = "thr_main";
const TURN_ID = "turn_edits";

const completedTurnRows: TimelineRow[] = [
  conversationRow({
    id: "user_message",
    role: "user",
    text: "Update the docs",
    threadId: THREAD_ID,
    turnId: TURN_ID,
    sourceSeqStart: 1,
  }),
  turnRow({
    id: "turn_summary",
    threadId: THREAD_ID,
    turnId: TURN_ID,
    sourceSeqStart: 10,
    sourceSeqEnd: 20,
    editedFiles: [
      { path: "src/app.ts", added: 3, removed: 1, kind: "edited" },
      { path: "README.md", added: 1, removed: 0, kind: "edited" },
    ],
  }),
  conversationRow({
    id: "assistant_message",
    role: "assistant",
    text: "Docs updated.",
    threadId: THREAD_ID,
    turnId: TURN_ID,
    sourceSeqStart: 21,
  }),
];

function renderTimeline(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

afterEach(() => {
  cleanup();
});

describe("ThreadTimelineRows edited files card", () => {
  it("renders the turn row's edited files after the last message of the completed turn", () => {
    const onViewTurnChanges = vi.fn();

    renderTimeline(
      <ThreadTimelineRows
        threadId={THREAD_ID}
        timelineRows={completedTurnRows}
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
        onViewTurnChanges={onViewTurnChanges}
      />,
    );

    const card = screen.getByRole("region", { name: "Edited files" });
    expect(screen.getByText("Edited 2 files")).not.toBeNull();
    const assistantRow = document.querySelector(
      '[data-timeline-row-id="assistant_message"]',
    );
    expect(assistantRow?.contains(card)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "View changes" }));
    fireEvent.click(screen.getByTitle("README.md"));

    expect(onViewTurnChanges).toHaveBeenNthCalledWith(1, [
      "src/app.ts",
      "README.md",
    ]);
    expect(onViewTurnChanges).toHaveBeenNthCalledWith(2, ["README.md"]);
  });

  it("does not render a card for an in-progress turn", () => {
    renderTimeline(
      <ThreadTimelineRows
        threadId={THREAD_ID}
        timelineRows={[
          conversationRow({
            id: "user_live",
            role: "user",
            text: "Keep going",
            turnId: "turn_live",
          }),
          fileChangeRow({ id: "edit_live", turnId: "turn_live" }),
        ]}
        threadRuntimeDisplayStatus="active"
        workspaceRootPath={undefined}
        onViewTurnChanges={vi.fn()}
      />,
    );

    expect(screen.queryByRole("region", { name: "Edited files" })).toBeNull();
  });

  it("does not render the card when the host cannot open turn changes", () => {
    renderTimeline(
      <ThreadTimelineRows
        threadId={THREAD_ID}
        timelineRows={completedTurnRows}
        threadRuntimeDisplayStatus="idle"
        workspaceRootPath={undefined}
      />,
    );

    expect(screen.queryByRole("region", { name: "Edited files" })).toBeNull();
  });
});
