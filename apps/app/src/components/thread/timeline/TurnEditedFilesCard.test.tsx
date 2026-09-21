// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnEditedFilesCard } from "./TurnEditedFilesCard";
import type { TimelineTurnEditedFile } from "@bb/server-contract";

function editedFiles(count: number): TimelineTurnEditedFile[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `src/module-${index}.ts`,
    added: index,
    removed: 1,
    kind: "edited",
  }));
}

afterEach(() => {
  cleanup();
});

describe("TurnEditedFilesCard", () => {
  it("uses the singular header for one file", () => {
    render(
      <TurnEditedFilesCard
        files={editedFiles(1)}
        onOpenFile={null}
        onViewChanges={null}
      />,
    );
    expect(screen.getByText("Edited 1 file")).not.toBeNull();
  });

  it("collapses after eight files and expands the rest in place", () => {
    render(
      <TurnEditedFilesCard
        files={editedFiles(12)}
        onOpenFile={vi.fn()}
        onViewChanges={null}
      />,
    );

    expect(screen.getByText("Edited 12 files")).not.toBeNull();
    expect(screen.queryByText("module-8.ts")).toBeNull();
    const more = screen.getByRole("button", { name: "+4 more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(more);

    expect(screen.getByText("module-11.ts")).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Show less" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("opens the clicked file by its full path and views the turn changes", () => {
    const onOpenFile = vi.fn();
    const onViewChanges = vi.fn();
    render(
      <TurnEditedFilesCard
        files={editedFiles(2)}
        onOpenFile={onOpenFile}
        onViewChanges={onViewChanges}
      />,
    );

    fireEvent.click(screen.getByTitle("src/module-1.ts"));
    fireEvent.click(screen.getByRole("button", { name: "View changes" }));

    expect(onOpenFile).toHaveBeenCalledWith("src/module-1.ts");
    expect(onViewChanges).toHaveBeenCalledTimes(1);
  });

  it("shows only removed lines for a deleted file", () => {
    render(
      <TurnEditedFilesCard
        files={[{ path: "old.ts", added: 0, removed: 9, kind: "deleted" }]}
        onOpenFile={null}
        onViewChanges={null}
      />,
    );
    expect(screen.getByText("−9")).not.toBeNull();
    expect(screen.queryByText("+0")).toBeNull();
  });
});
