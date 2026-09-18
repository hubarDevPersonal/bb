import { describe, expect, it } from "vitest";
import { projectSpecCandidates } from "./project-specs.js";

describe("projectSpecCandidates", () => {
  it("builds a PROJECT.md candidate for a local-path source on a connected host", () => {
    const candidates = projectSpecCandidates(
      [
        {
          id: "proj_1",
          name: "bb",
          sources: [{ type: "local_path", hostId: "host_1", path: "/work/bb" }],
        },
      ],
      new Set(["host_1"]),
    );
    expect(candidates).toEqual([
      {
        projectId: "proj_1",
        projectName: "bb",
        hostId: "host_1",
        rootPath: "/work/bb",
        path: "/work/bb/.claude/specs/PROJECT.md",
      },
    ]);
  });

  it("strips a trailing slash from the project root before joining", () => {
    const candidates = projectSpecCandidates(
      [
        {
          id: "proj_1",
          name: "bb",
          sources: [
            { type: "local_path", hostId: "host_1", path: "/work/bb/" },
          ],
        },
      ],
      new Set(["host_1"]),
    );
    expect(candidates[0]!.path).toBe("/work/bb/.claude/specs/PROJECT.md");
  });

  it("skips sources on a host that is not connected", () => {
    const candidates = projectSpecCandidates(
      [
        {
          id: "proj_1",
          name: "bb",
          sources: [
            { type: "local_path", hostId: "host_offline", path: "/work/bb" },
          ],
        },
      ],
      new Set(["host_1"]),
    );
    expect(candidates).toEqual([]);
  });

  it("skips non local-path sources and empty root paths", () => {
    const candidates = projectSpecCandidates(
      [
        {
          id: "proj_1",
          name: "bb",
          sources: [
            { type: "git_remote", hostId: "host_1", path: "/anything" },
            { type: "local_path", hostId: "host_1", path: "" },
          ],
        },
      ],
      new Set(["host_1"]),
    );
    expect(candidates).toEqual([]);
  });

  it("lists one candidate per local-path source across multiple projects", () => {
    const candidates = projectSpecCandidates(
      [
        {
          id: "proj_1",
          name: "bb",
          sources: [{ type: "local_path", hostId: "host_1", path: "/work/bb" }],
        },
        {
          id: "proj_2",
          name: "notch-bridge",
          sources: [
            { type: "local_path", hostId: "host_1", path: "/work/notch" },
            { type: "local_path", hostId: "host_2", path: "/mac/notch" },
          ],
        },
      ],
      new Set(["host_1"]),
    );
    expect(candidates.map((candidate) => candidate.projectId)).toEqual([
      "proj_1",
      "proj_2",
    ]);
    expect(candidates).toHaveLength(2);
  });
});
