import { describe, expect, it } from "vitest";
import { ROUTING_FIXTURE_ENTRIES } from "./__fixtures__/routing.js";
import { modelPickerState, multiModelSummaryRows } from "./model-routing.js";

const MODELS = [
  { id: "claude-haiku-4-5", displayName: "Haiku 4.5" },
  { id: "claude-sonnet-5", displayName: "Sonnet 5" },
  { id: "claude-opus-5", displayName: "Opus 5" },
];

describe("modelPickerState", () => {
  it("marks a disallowed current value and never offers it", () => {
    expect(
      modelPickerState(
        "scout",
        { ok: true, model: "claude-haiku-4-5", effort: null },
        MODELS,
      ),
    ).toEqual({
      options: [MODELS[1], MODELS[2]],
      currentAllowed: false,
    });
  });

  it("keeps an allowed alias missing from the catalog selectable", () => {
    expect(
      modelPickerState(
        "implementer",
        { ok: true, model: "claude-opus-5[1m]", effort: null },
        MODELS,
      ),
    ).toEqual({
      options: [
        { id: "claude-opus-5[1m]", displayName: "claude-opus-5[1m]" },
        MODELS[2],
      ],
      currentAllowed: true,
    });
  });
});

describe("multiModelSummaryRows", () => {
  it("lists all five roles from the resolved routing", () => {
    expect(
      multiModelSummaryRows({
        routing: { ok: true, entries: ROUTING_FIXTURE_ENTRIES },
        rows: {
          implementer: { ok: true, model: "claude-opus-5", effort: null },
          scout: { ok: true, model: "claude-sonnet-5", effort: "low" },
          reviewer: { ok: false, error: "missing_file" },
        },
        reviewTarget: {
          ok: true,
          providerId: "codex",
          providerName: "Codex",
          model: "gpt-5.6-sol",
          effort: "high",
          reasoningLevel: "high",
          source: "routing-cross-vendor",
        },
      }),
    ).toEqual([
      ["Architect (this thread)", "claude-code/claude-fable-5-1 (high)"],
      ["Implementer", "claude-code/claude-opus-5 (high)"],
      ["Scout", "claude-code/claude-sonnet-5 (low)"],
      ["Reviewer subagent", "Agent file not found"],
      ["Cross-vendor review", "codex/gpt-5.6-sol (high)"],
    ]);
  });
});
