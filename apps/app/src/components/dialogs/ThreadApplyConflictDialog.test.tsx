// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadApplyConflictDialog } from "./ThreadApplyConflictDialog";

afterEach(() => {
  cleanup();
});

describe("ThreadApplyConflictDialog", () => {
  it("lists the conflicted files when open", () => {
    render(
      <ThreadApplyConflictDialog
        conflictedFiles={["src/a.ts", "src/b.ts"]}
        onOpenChange={vi.fn()}
        open
      />,
    );

    expect(
      screen.getByText("Apply changes locally: conflicts found"),
    ).not.toBeNull();
    expect(screen.getByText("src/a.ts")).not.toBeNull();
    expect(screen.getByText("src/b.ts")).not.toBeNull();
  });

  it("renders nothing when closed", () => {
    render(
      <ThreadApplyConflictDialog
        conflictedFiles={["src/a.ts"]}
        onOpenChange={vi.fn()}
        open={false}
      />,
    );

    expect(screen.queryByText("src/a.ts")).toBeNull();
  });
});
