// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTaskDiffTurnFilter } from "./useTaskDiffTurnFilter";

interface HookProps {
  isTaskDiffActive: boolean;
  threadId: string;
}

function renderFilter(initialProps: HookProps) {
  return renderHook((props: HookProps) => useTaskDiffTurnFilter(props), {
    initialProps,
  });
}

afterEach(() => {
  cleanup();
});

describe("useTaskDiffTurnFilter", () => {
  it("exposes the applied turn paths and clears them from Show all", () => {
    const { result } = renderFilter({
      isTaskDiffActive: false,
      threadId: "thr_1",
    });

    act(() => {
      result.current.apply(["src/app.ts", "README.md"]);
    });
    expect([...(result.current.fileFilter?.paths ?? [])]).toEqual([
      "src/app.ts",
      "README.md",
    ]);

    act(() => {
      result.current.fileFilter?.onClear();
    });
    expect(result.current.fileFilter).toBeNull();
  });

  it("keeps the filter while the Task diff tab opens and clears it when the tab is left", () => {
    const { result, rerender } = renderFilter({
      isTaskDiffActive: false,
      threadId: "thr_1",
    });

    act(() => {
      result.current.apply(["src/app.ts"]);
    });
    rerender({ isTaskDiffActive: true, threadId: "thr_1" });
    expect(result.current.fileFilter).not.toBeNull();

    rerender({ isTaskDiffActive: false, threadId: "thr_1" });
    expect(result.current.fileFilter).toBeNull();
  });

  it("clears the filter when the thread changes", () => {
    const { result, rerender } = renderFilter({
      isTaskDiffActive: true,
      threadId: "thr_1",
    });

    act(() => {
      result.current.apply(["src/app.ts"]);
    });
    rerender({ isTaskDiffActive: true, threadId: "thr_2" });
    expect(result.current.fileFilter).toBeNull();

    rerender({ isTaskDiffActive: true, threadId: "thr_1" });
    expect(result.current.fileFilter).toBeNull();
  });
});
