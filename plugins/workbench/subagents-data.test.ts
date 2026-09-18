import { describe, expect, it } from "vitest";
import {
  extractCreatedFilePaths,
  subagentStatus,
  subagentTitle,
} from "./subagents-data.js";

describe("subagentStatus", () => {
  it.each([
    ["idle", "done"],
    ["error", "done"],
    ["starting", "active"],
    ["active", "active"],
    ["stopping", "active"],
    ["provisioning", "active"],
    ["host-reconnecting", "active"],
    ["waiting-for-host", "active"],
  ] as const)("maps %s to %s", (displayStatus, expected) => {
    expect(subagentStatus(displayStatus)).toBe(expected);
  });
});

describe("subagentTitle", () => {
  it("prefers the title", () => {
    expect(
      subagentTitle({ id: "thr_1", title: "Fix bug", titleFallback: "old" }),
    ).toBe("Fix bug");
  });

  it("falls back to titleFallback when title is null", () => {
    expect(
      subagentTitle({
        id: "thr_1",
        title: null,
        titleFallback: "Investigate flaky test",
      }),
    ).toBe("Investigate flaky test");
  });

  it("falls back to a stable label when both are null", () => {
    expect(
      subagentTitle({ id: "thr_1", title: null, titleFallback: null }),
    ).toBe("Subagent thr_1");
  });
});

describe("extractCreatedFilePaths", () => {
  it("keeps a created file", () => {
    expect(extractCreatedFilePaths([{ path: "a.ts", kind: "add" }])).toEqual([
      "a.ts",
    ]);
  });

  it("drops a file that was only modified, never created here", () => {
    expect(extractCreatedFilePaths([{ path: "b.ts", kind: "update" }])).toEqual(
      [],
    );
  });

  it("drops a file that was created then deleted", () => {
    expect(
      extractCreatedFilePaths([
        { path: "c.ts", kind: "delete" },
        { path: "c.ts", kind: "add" },
      ]),
    ).toEqual([]);
  });

  it("collapses duplicate rows for the same created file", () => {
    expect(
      extractCreatedFilePaths([
        { path: "d.ts", kind: "update" },
        { path: "d.ts", kind: "add" },
      ]),
    ).toEqual(["d.ts"]);
  });

  it("orders created files latest first", () => {
    expect(
      extractCreatedFilePaths([
        { path: "e.ts", kind: "add" },
        { path: "f.ts", kind: "add" },
      ]),
    ).toEqual(["e.ts", "f.ts"]);
  });
});
