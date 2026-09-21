import { describe, expect, it } from "vitest";
import type {
  TimelineApprovalStatus,
  TimelineFileChangeWorkRow,
  TimelineRow,
  TimelineRowStatus,
  TimelineTurnEditedFile,
} from "@bb/server-contract";
import { buildTurnEditedFiles } from "../src/index.js";
import { getProjectionFileChangeDiffStats } from "../src/turn-edited-files.js";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

interface FileChangeRowArgs {
  id: string;
  path: string;
  kind?: string;
  movePath?: string | null;
  diff?: string | null;
  added?: number;
  removed?: number;
  status?: TimelineRowStatus;
  approvalStatus?: TimelineApprovalStatus;
}

function fileChangeRow({
  id,
  path,
  kind = "update",
  movePath = null,
  diff = "@@ -1 +1 @@\n-a\n+b",
  added = 1,
  removed = 1,
  status = "completed",
  approvalStatus = null,
}: FileChangeRowArgs): TimelineFileChangeWorkRow {
  return {
    id,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 1,
    createdAt: 1,
    kind: "work",
    workKind: "file-change",
    status,
    callId: id,
    change: { path, kind, movePath, diff, diffStats: { added, removed } },
    stdout: null,
    stderr: null,
    approvalStatus,
  };
}

function turnSummaryRow(
  id: string,
  editedFiles: TimelineTurnEditedFile[],
): TimelineRow {
  return {
    id,
    threadId: "thread-1",
    turnId: "turn-1",
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    startedAt: 1,
    createdAt: 1,
    kind: "turn",
    status: "completed",
    summaryCount: 1,
    editedFiles,
    completedAt: 2,
    children: null,
  };
}

describe("buildTurnEditedFiles", () => {
  it("returns one entry for a single edited file", () => {
    expect(
      buildTurnEditedFiles([
        fileChangeRow({ id: "e1", path: "src/app.ts", added: 3, removed: 1 }),
      ]),
    ).toEqual([{ path: "src/app.ts", added: 3, removed: 1, kind: "edited" }]);
  });

  it("sums repeated edits to one path into one entry", () => {
    expect(
      buildTurnEditedFiles([
        fileChangeRow({ id: "e1", path: "src/app.ts", added: 3, removed: 1 }),
        fileChangeRow({ id: "e2", path: "src/app.ts", added: 2, removed: 4 }),
      ]),
    ).toEqual([{ path: "src/app.ts", added: 5, removed: 5, kind: "edited" }]);
  });

  it("keeps first-touched order and resolves add, update and delete kinds", () => {
    expect(
      buildTurnEditedFiles([
        fileChangeRow({ id: "update", path: "src/z.ts" }),
        fileChangeRow({
          id: "add",
          path: "src/a.ts",
          kind: "add",
          added: 10,
          removed: 0,
        }),
        fileChangeRow({ id: "add_then_edit", path: "src/a.ts", added: 2 }),
        fileChangeRow({
          id: "delete",
          path: "src/old.ts",
          kind: "delete",
          added: 0,
          removed: 7,
        }),
      ]).map((file) => [file.path, file.kind, file.added, file.removed]),
    ).toEqual([
      ["src/z.ts", "edited", 1, 1],
      ["src/a.ts", "created", 12, 1],
      ["src/old.ts", "deleted", 0, 7],
    ]);
  });

  it("keys renames by their destination path", () => {
    expect(
      buildTurnEditedFiles([
        fileChangeRow({
          id: "rename",
          path: "src/old-name.ts",
          movePath: "src/new-name.ts",
          diff: null,
          added: 0,
          removed: 0,
        }),
      ]),
    ).toEqual([
      { path: "src/new-name.ts", added: 0, removed: 0, kind: "renamed" },
    ]);
  });

  it("skips denied, waiting and failed edits", () => {
    expect(
      buildTurnEditedFiles([
        fileChangeRow({ id: "denied", path: "a", approvalStatus: "denied" }),
        fileChangeRow({
          id: "waiting",
          path: "b",
          approvalStatus: "waiting_for_approval",
          status: "pending",
        }),
        fileChangeRow({ id: "failed", path: "c", status: "error" }),
      ]),
    ).toEqual([]);
  });

  it("merges turn summary rows with top-level file changes", () => {
    expect(
      buildTurnEditedFiles([
        turnSummaryRow("turn:0", [
          { path: "src/app.ts", added: 4, removed: 0, kind: "created" },
        ]),
        fileChangeRow({ id: "later", path: "src/app.ts", added: 1 }),
        turnSummaryRow("turn:1", [
          { path: "README.md", added: 2, removed: 2, kind: "edited" },
        ]),
      ]),
    ).toEqual([
      { path: "src/app.ts", added: 5, removed: 1, kind: "created" },
      { path: "README.md", added: 2, removed: 2, kind: "edited" },
    ]);
  });
});

describe("getProjectionFileChangeDiffStats", () => {
  it("parses a change's diff once and reuses the stats", () => {
    const change = { path: "src/app.ts", kind: "update", diff: "@@\n-a\n+b" };
    const first = getProjectionFileChangeDiffStats(change);
    expect(first).toEqual({ added: 1, removed: 1 });
    expect(getProjectionFileChangeDiffStats(change)).toBe(first);
  });
});

describe("completed turn row editedFiles", () => {
  it("keeps edited files on a summary turn whose messages were dropped", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderTimelineFixture({
      events: [
        event.turnStarted(),
        event.fileChangeCompleted({
          itemId: "edit-1",
          changes: [{ path: "src/app.ts", kind: "update", diff: "@@\n-a\n+b" }],
        }),
        event.assistantCompleted({ itemId: "assistant-1", text: "Done." }),
        event.turnCompleted(),
      ],
      includeNestedRows: false,
      projectionOptions: {
        threadStatus: "idle",
        turnMessageDetail: "summary",
      },
    });

    const turnEntry = timeline.projection.entries.find(
      (entry) => entry.kind === "turn",
    );
    expect(turnEntry?.kind === "turn" && turnEntry.turn.messages).toBe(
      undefined,
    );
    expect(timeline.turnRows[0]?.editedFiles).toEqual([
      { path: "src/app.ts", added: 1, removed: 1, kind: "edited" },
    ]);
  });

  it("summarizes the turn's applied edits, including delegated subagent edits", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const timeline = renderTimelineFixture({
      events: [
        event.turnStarted({ turnId: "parent-turn" }),
        event.fileChangeCompleted({
          turnId: "parent-turn",
          itemId: "edit-1",
          changes: [
            { path: "src/app.ts", kind: "update", diff: "@@\n-a\n+b\n+c" },
          ],
        }),
        event.fileChangeCompleted({
          turnId: "parent-turn",
          itemId: "edit-denied",
          approvalStatus: "denied",
          changes: [{ path: "src/secret.ts", kind: "update", diff: "@@\n+x" }],
        }),
        event.delegationStarted({
          turnId: "parent-turn",
          itemId: "call-1",
          childRef: "agent-thread-1",
          label: "/root/write_docs",
        }),
        event.turnStarted({ turnId: "child-turn", parentToolCallId: "call-1" }),
        event.fileChangeCompleted({
          turnId: "child-turn",
          parentToolCallId: "call-1",
          itemId: "child-edit",
          changes: [{ path: "docs/guide.md", kind: "add", diff: "one\ntwo" }],
        }),
        event.turnCompleted({ turnId: "child-turn" }),
        event.delegationCompleted({
          turnId: "parent-turn",
          itemId: "call-1",
          childRef: "agent-thread-1",
          label: "/root/write_docs",
        }),
        event.fileChangeCompleted({
          turnId: "parent-turn",
          itemId: "edit-2",
          changes: [{ path: "src/app.ts", kind: "update", diff: "@@\n-c" }],
        }),
        event.assistantCompleted({
          turnId: "parent-turn",
          itemId: "assistant-1",
          text: "Done.",
        }),
        event.turnCompleted({ turnId: "parent-turn" }),
      ],
      includeNestedRows: false,
      projectionOptions: {
        threadStatus: "idle",
        turnMessageDetail: "summary",
      },
    });

    expect(timeline.turnRows).toHaveLength(1);
    expect(timeline.turnRows[0]?.children).toBeNull();
    expect(timeline.turnRows[0]?.editedFiles).toEqual([
      { path: "src/app.ts", added: 2, removed: 2, kind: "edited" },
      { path: "docs/guide.md", added: 2, removed: 0, kind: "created" },
    ]);
  });
});
