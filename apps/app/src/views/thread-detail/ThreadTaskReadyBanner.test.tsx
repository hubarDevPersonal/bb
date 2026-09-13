// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadTaskActionsState } from "./useThreadTaskActions";
import {
  shouldShowThreadTaskReadyBanner,
  ThreadTaskReadyBanner,
} from "./ThreadTaskReadyBanner";

function makeThreadTaskActions(
  overrides: Partial<ThreadTaskActionsState> = {},
): ThreadTaskActionsState {
  return {
    apply: vi.fn(),
    canApply: false,
    canReview: true,
    conflictDialog: {
      conflictedFiles: [],
      onOpenChange: vi.fn(),
      open: false,
    },
    pending: false,
    review: vi.fn(),
    stats: { changedFiles: 2, deletions: 3, insertions: 5 },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("shouldShowThreadTaskReadyBanner", () => {
  it("shows when a turn has completed and there are reviewable changes", () => {
    expect(
      shouldShowThreadTaskReadyBanner({
        canReview: true,
        hasCompletedTurn: true,
      }),
    ).toBe(true);
  });

  it("hides before any turn has completed", () => {
    expect(
      shouldShowThreadTaskReadyBanner({
        canReview: true,
        hasCompletedTurn: false,
      }),
    ).toBe(false);
  });

  it("hides when there is nothing to review", () => {
    expect(
      shouldShowThreadTaskReadyBanner({
        canReview: false,
        hasCompletedTurn: true,
      }),
    ).toBe(false);
  });
});

describe("ThreadTaskReadyBanner", () => {
  it("renders the diff stats and hides Apply changes locally when it is not allowed", () => {
    render(
      <ThreadTaskReadyBanner
        hasCompletedTurn
        taskActions={makeThreadTaskActions()}
      />,
    );

    expect(screen.getByText("Task is ready for review")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Review" })).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: "Apply changes locally" }),
    ).toBeNull();
  });

  it("shows Apply changes locally when allowed", () => {
    render(
      <ThreadTaskReadyBanner
        hasCompletedTurn
        taskActions={makeThreadTaskActions({ canApply: true })}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Apply changes locally" }),
    ).not.toBeNull();
  });

  it("renders nothing before a turn has completed", () => {
    const { container } = render(
      <ThreadTaskReadyBanner
        hasCompletedTurn={false}
        taskActions={makeThreadTaskActions()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when there is nothing to review", () => {
    const { container } = render(
      <ThreadTaskReadyBanner
        hasCompletedTurn
        taskActions={makeThreadTaskActions({ canReview: false, stats: null })}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("disables Review and Apply changes locally while the shared task actions are pending", () => {
    render(
      <ThreadTaskReadyBanner
        hasCompletedTurn
        taskActions={makeThreadTaskActions({ canApply: true, pending: true })}
      />,
    );

    expect(screen.getByRole("button", { name: "Review" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(
      screen.getByRole("button", { name: "Apply changes locally" }),
    ).toHaveProperty("disabled", true);
  });
});
