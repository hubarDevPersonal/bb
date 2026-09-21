import { describe, expect, it } from "vitest";
import {
  ROUTING_FIXTURE,
  ROUTING_FIXTURE_ENTRIES,
} from "./__fixtures__/routing.js";
import {
  allowedModelsForRole,
  isModelAllowedForRole,
  parseRoutingTable,
  routingDrift,
} from "./routing.js";

describe("parseRoutingTable", () => {
  it("parses every role of the real ROUTING.md table", () => {
    expect(parseRoutingTable(ROUTING_FIXTURE)).toEqual(ROUTING_FIXTURE_ENTRIES);
  });

  it("returns no entries without a table", () => {
    expect(parseRoutingTable("")).toEqual([]);
    expect(parseRoutingTable("# Routing\n\nNo table here.\n")).toEqual([]);
  });

  it("tolerates extra spaces, CRLF, and bold around the model cell", () => {
    const markdown =
      "| Роль | Что | Модель | Усилие |\r\n" +
      "|---|---|---|---|\r\n" +
      "|  **Reviewer,   внутри  треда**  (x) | y |  ** claude-code   /   `opus-x` **  |   medium  |\r\n";
    expect(parseRoutingTable(markdown)).toEqual([
      {
        role: "reviewer-subagent",
        providerId: "claude-code",
        model: "opus-x",
        subagentModel: null,
        effort: "medium",
      },
    ]);
  });

  it("reports a missing or empty effort as null", () => {
    const markdown =
      "| **Scout** | find | claude-code / `sonnet-x` |\n" +
      "| **Architect** | plan | claude-code / `fable-x` |  |\n";
    expect(parseRoutingTable(markdown)).toEqual([
      {
        role: "scout",
        providerId: "claude-code",
        model: "sonnet-x",
        subagentModel: null,
        effort: null,
      },
      {
        role: "architect",
        providerId: "claude-code",
        model: "fable-x",
        subagentModel: null,
        effort: null,
      },
    ]);
  });

  it("ignores unknown roles, rows without a model cell, and duplicate roles", () => {
    const markdown =
      "| **Designer** | draws | claude-code / `x` | high |\n" +
      "| **Scout** | find | no model here | high |\n" +
      "| **Implementer** | code | claude-code / `first` | high |\n" +
      "| **Implementer** | code | claude-code / `second` | high |\n";
    expect(parseRoutingTable(markdown)).toEqual([
      {
        role: "implementer",
        providerId: "claude-code",
        model: "first",
        subagentModel: null,
        effort: "high",
      },
    ]);
  });
});

describe("allowedModelsForRole", () => {
  const catalog = [
    { id: "claude-haiku-4-5", displayName: "Haiku 4.5" },
    { id: "fast-small", displayName: "HAIKU small" },
    { id: "claude-sonnet-5", displayName: "Sonnet 5" },
    { id: "claude-opus-5", displayName: "Opus 5" },
  ];

  it("offers sonnet only to scout and never haiku", () => {
    expect(allowedModelsForRole("scout", catalog).map((m) => m.id)).toEqual([
      "claude-sonnet-5",
      "claude-opus-5",
    ]);
    for (const role of ["implementer", "reviewer"] as const) {
      expect(allowedModelsForRole(role, catalog).map((m) => m.id)).toEqual([
        "claude-opus-5",
      ]);
    }
  });

  it("checks both the id and the display name", () => {
    expect(
      isModelAllowedForRole("implementer", {
        id: "opaque-id",
        displayName: "Claude Sonnet",
      }),
    ).toBe(false);
    expect(
      isModelAllowedForRole("scout", { id: "HAIKU", displayName: "x" }),
    ).toBe(false);
  });
});

describe("routingDrift", () => {
  it("compares the implementer with the subagent model", () => {
    expect(
      routingDrift("implementer", "claude-opus-5", ROUTING_FIXTURE_ENTRIES),
    ).toBeNull();
    expect(
      routingDrift("implementer", "claude-opus-5[1m]", ROUTING_FIXTURE_ENTRIES),
    ).toBe("claude-opus-5");
  });

  it("compares the reviewer subagent with the in-thread reviewer row", () => {
    expect(
      routingDrift("reviewer", "claude-fable-5-1", ROUTING_FIXTURE_ENTRIES),
    ).toBeNull();
    expect(
      routingDrift("reviewer", "claude-opus-5", ROUTING_FIXTURE_ENTRIES),
    ).toBe("claude-fable-5-1");
    expect(
      routingDrift("scout", "claude-haiku-4-5", ROUTING_FIXTURE_ENTRIES),
    ).toBe("claude-sonnet-5");
  });

  it("reports no drift without a routing row", () => {
    expect(routingDrift("scout", "anything", [])).toBeNull();
  });
});
