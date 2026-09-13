import { describe, expect, it, vi } from "vitest";
import type { ThreadTaskActionsState } from "./useThreadTaskActions";
import { buildThreadTaskResponsiveActions } from "./threadTaskResponsiveActions";

function makeThreadTaskActions(
  overrides: Partial<ThreadTaskActionsState> = {},
): ThreadTaskActionsState {
  return {
    apply: vi.fn(),
    canApply: false,
    canReview: false,
    conflictDialog: {
      conflictedFiles: [],
      onOpenChange: vi.fn(),
      open: false,
    },
    pending: false,
    review: vi.fn(),
    stats: null,
    ...overrides,
  };
}

describe("buildThreadTaskResponsiveActions", () => {
  it("is empty when neither review nor apply is available", () => {
    expect(buildThreadTaskResponsiveActions(makeThreadTaskActions())).toEqual(
      [],
    );
  });

  it("includes only Review when apply is not available", () => {
    const review = vi.fn();
    const actions = buildThreadTaskResponsiveActions(
      makeThreadTaskActions({ canReview: true, review }),
    );
    expect(actions).toEqual([
      { icon: "Eye", label: "Review", onSelect: review },
    ]);
  });

  it("includes both Review and Apply changes locally when both are available", () => {
    const review = vi.fn();
    const apply = vi.fn();
    const actions = buildThreadTaskResponsiveActions(
      makeThreadTaskActions({
        apply,
        canApply: true,
        canReview: true,
        review,
      }),
    );
    expect(actions).toEqual([
      { icon: "Eye", label: "Review", onSelect: review },
      { icon: "GitMerge", label: "Apply changes locally", onSelect: apply },
    ]);
  });
});
