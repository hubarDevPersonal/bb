import { describe, expect, it } from "vitest";
import {
  SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
} from "./sidebarRowClasses";

describe("sidebar thread state styling", () => {
  it("uses the sidebar-selected surface", () => {
    expect(SIDEBAR_ROW_SELECTED_STATE_CLASS).toContain("bg-sidebar-selected");
  });

  it("marks the row for an opaque backing surface when it becomes sticky", () => {
    expect(SIDEBAR_ROW_SELECTED_STATE_CLASS).toContain(
      "bb-sidebar-selected-row",
    );
  });

  it("marks open-in-split rows for an opaque sidebar-resolved tint", () => {
    expect(SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS).toBe(
      "bb-sidebar-open-in-split-row",
    );
  });
});
