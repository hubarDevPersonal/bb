import { describe, expect, it } from "vitest";
import { buildTimelineViewRows } from "@bb/thread-view";
import {
  conversationRow,
  fileChangeRow,
  turnRow,
} from "@/test/fixtures/thread-timeline-rows";
import {
  collectCompletedTurnEditedFilesAnchors,
  resolveEditedFileIconKind,
} from "./turn-edited-files";

describe("resolveEditedFileIconKind", () => {
  it.each([
    ["src/app.tsx", "code"],
    ["scripts/build.sh", "code"],
    ["README.md", "markdown"],
    ["docs/page.MDX", "markdown"],
    ["package.json", "json"],
    ["tsconfig.jsonc", "json"],
    ["assets/logo.png", "other"],
    ["Makefile", "other"],
    [".env", "other"],
  ])("%s -> %s", (path, kind) => {
    expect(resolveEditedFileIconKind(path)).toBe(kind);
  });
});

describe("collectCompletedTurnEditedFilesAnchors", () => {
  it("anchors a completed turn on its last row and ignores in-progress turns", () => {
    const rows = buildTimelineViewRows([
      conversationRow({ id: "user_1", role: "user", text: "Go", turnId: "t1" }),
      turnRow({ id: "turn_1", turnId: "t1" }),
      conversationRow({
        id: "assistant_1",
        role: "assistant",
        text: "Done",
        turnId: "t1",
      }),
      conversationRow({
        id: "user_2",
        role: "user",
        text: "More",
        turnId: "t2",
      }),
      fileChangeRow({ id: "live_edit", turnId: "t2", status: "pending" }),
    ]);

    const anchors = collectCompletedTurnEditedFilesAnchors(rows);

    expect([...anchors.keys()]).toEqual(["assistant_1"]);
    expect(anchors.get("assistant_1")?.rows.map((row) => row.id)).toEqual([
      "user_1",
      "turn_1",
      "assistant_1",
    ]);
  });
});
