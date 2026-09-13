import { describe, expect, it } from "vitest";
import {
  resolveNextTaskDiffFileIndex,
  resolvePreviousTaskDiffFileIndex,
  resolveTaskDiffFileNavDisplay,
} from "./taskDiffFileNav";

describe("resolveTaskDiffFileNavDisplay", () => {
  it("shows 0 / N before the user navigates", () => {
    expect(resolveTaskDiffFileNavDisplay(null, 3)).toEqual({
      currentOneBased: 0,
      fileCount: 3,
      isNextDisabled: false,
      isPrevDisabled: true,
    });
  });

  it("disables prev at the first file and next at the last file", () => {
    expect(resolveTaskDiffFileNavDisplay(0, 3)).toMatchObject({
      currentOneBased: 1,
      isNextDisabled: false,
      isPrevDisabled: true,
    });
    expect(resolveTaskDiffFileNavDisplay(2, 3)).toMatchObject({
      currentOneBased: 3,
      isNextDisabled: true,
      isPrevDisabled: false,
    });
  });

  it("disables both directions when there are no files", () => {
    expect(resolveTaskDiffFileNavDisplay(null, 0)).toEqual({
      currentOneBased: 0,
      fileCount: 0,
      isNextDisabled: true,
      isPrevDisabled: true,
    });
  });

  it("clamps an index that now points past the end of a shrunk file list", () => {
    expect(resolveTaskDiffFileNavDisplay(5, 2)).toMatchObject({
      currentOneBased: 2,
      isNextDisabled: true,
      isPrevDisabled: false,
    });
  });
});

describe("resolvePreviousTaskDiffFileIndex", () => {
  it("does not wrap around past the first file", () => {
    expect(resolvePreviousTaskDiffFileIndex(0, 3)).toBe(0);
  });

  it("moves to the previous index", () => {
    expect(resolvePreviousTaskDiffFileIndex(2, 3)).toBe(1);
  });

  it("stays at null before the first navigation", () => {
    expect(resolvePreviousTaskDiffFileIndex(null, 3)).toBeNull();
  });

  it("clamps before moving when the file list shrank", () => {
    expect(resolvePreviousTaskDiffFileIndex(5, 2)).toBe(0);
  });
});

describe("resolveNextTaskDiffFileIndex", () => {
  it("starts at the first file on the first navigation", () => {
    expect(resolveNextTaskDiffFileIndex(null, 3)).toBe(0);
  });

  it("does not wrap around past the last file", () => {
    expect(resolveNextTaskDiffFileIndex(2, 3)).toBe(2);
  });

  it("moves to the next index", () => {
    expect(resolveNextTaskDiffFileIndex(0, 3)).toBe(1);
  });

  it("returns null when there are no files", () => {
    expect(resolveNextTaskDiffFileIndex(null, 0)).toBeNull();
  });

  it("clamps before moving when the file list shrank", () => {
    expect(resolveNextTaskDiffFileIndex(5, 2)).toBe(1);
  });
});
