export interface TaskDiffFileNavDisplay {
  currentOneBased: number;
  fileCount: number;
  isNextDisabled: boolean;
  isPrevDisabled: boolean;
}

function clampTaskDiffFileIndex(
  index: number | null,
  fileCount: number,
): number | null {
  if (index === null || fileCount === 0) {
    return null;
  }
  return Math.min(index, fileCount - 1);
}

export function resolveTaskDiffFileNavDisplay(
  index: number | null,
  fileCount: number,
): TaskDiffFileNavDisplay {
  const clamped = clampTaskDiffFileIndex(index, fileCount);
  return {
    currentOneBased: clamped === null ? 0 : clamped + 1,
    fileCount,
    isNextDisabled: fileCount === 0 || clamped === fileCount - 1,
    isPrevDisabled: clamped === null || clamped <= 0,
  };
}

export function resolvePreviousTaskDiffFileIndex(
  index: number | null,
  fileCount: number,
): number | null {
  const clamped = clampTaskDiffFileIndex(index, fileCount);
  if (clamped === null || clamped <= 0) {
    return clamped;
  }
  return clamped - 1;
}

export function resolveNextTaskDiffFileIndex(
  index: number | null,
  fileCount: number,
): number | null {
  const clamped = clampTaskDiffFileIndex(index, fileCount);
  if (fileCount === 0) {
    return null;
  }
  if (clamped === null) {
    return 0;
  }
  if (clamped >= fileCount - 1) {
    return clamped;
  }
  return clamped + 1;
}
