import { describe, expect, it } from "vitest";
import {
  acceptanceCommand,
  prefixFor,
  sourceRepos,
  isPlannerDescription,
  pickNext,
  type CandidateTask,
} from "./picker.js";

function task(key: string, priority: string, position: number, status = "todo"): CandidateTask {
  return { id: key, key, title: key, status, priority, position, projectId: "p", labelIds: ["auto"] };
}

describe("pickNext", () => {
  const tasks = [
    task("FUND-3", "medium", 3),
    task("FUND-1", "low", 1),
    task("FUND-2", "high", 2),
    task("FUND-4", "high", 1),
    task("FUND-5", "urgent", 9, "in_progress"),
  ];

  it("orders by priority, then board position", () => {
    const picked = pickNext({ tasks, trackedTaskIds: new Set(), skipTaskIds: new Set(), limit: 3 });
    expect(picked.map((t) => t.key)).toEqual(["FUND-4", "FUND-2", "FUND-3"]);
  });

  it("skips tracked, given-up and non-todo tasks", () => {
    const picked = pickNext({
      tasks,
      trackedTaskIds: new Set(["FUND-4"]),
      skipTaskIds: new Set(["FUND-2"]),
      limit: 5,
    });
    expect(picked.map((t) => t.key)).toEqual(["FUND-3", "FUND-1"]);
  });

  it("returns nothing without free slots", () => {
    expect(pickNext({ tasks, trackedTaskIds: new Set(), skipTaskIds: new Set(), limit: 0 })).toEqual([]);
  });

  it("does not return the same task twice", () => {
    const picked = pickNext({
      tasks: [task("A-1", "high", 1), task("A-1", "high", 1)],
      trackedTaskIds: new Set(),
      skipTaskIds: new Set(),
      limit: 2,
    });
    expect(picked).toHaveLength(1);
  });
});

describe("description markers", () => {
  it("finds the acceptance command with or without backticks", () => {
    expect(acceptanceCommand("Goal: x\nAcceptance: `make check`\nScope: go/")).toBe("make check");
    expect(acceptanceCommand("acceptance: go test ./...")).toBe("go test ./...");
    expect(acceptanceCommand("no command here")).toBeNull();
  });

  it("recognises planner tasks", () => {
    expect(isPlannerDescription("Kind: planner\n\nПополнить очередь")).toBe(true);
    expect(isPlannerDescription("Kind: code")).toBe(false);
  });
});

describe("planner sources", () => {
  it("lists repos once, in order", () => {
    expect(sourceRepos("fund: a.md, b.md\nGrowthOS: plan/tracks.md\n\nfund: c.md")).toEqual(["fund", "GrowthOS"]);
  });

  it("derives free tracker prefixes", () => {
    expect(prefixFor("fund", [])).toBe("FUND");
    expect(prefixFor("GrowthOS", [])).toBe("GROWTH");
    expect(prefixFor("fund", ["FUND"])).toBe("FUND2");
    expect(prefixFor("2fa-tool", [])).toBe("P2FATO");
  });
});
