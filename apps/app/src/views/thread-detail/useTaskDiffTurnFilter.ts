import { useCallback, useMemo, useState } from "react";
import type { TaskDiffFileFilter } from "@/components/secondary-panel/git-diff/TaskDiffPanelContent";

interface UseTaskDiffTurnFilterArgs {
  isTaskDiffActive: boolean;
  threadId: string;
}

interface TaskDiffTurnFilterController {
  apply: (paths: readonly string[]) => void;
  clear: () => void;
  fileFilter: TaskDiffFileFilter | null;
}

export function useTaskDiffTurnFilter({
  isTaskDiffActive,
  threadId,
}: UseTaskDiffTurnFilterArgs): TaskDiffTurnFilterController {
  const [paths, setPaths] = useState<ReadonlySet<string> | null>(null);
  const [trackedThreadId, setTrackedThreadId] = useState(threadId);
  const [wasTaskDiffActive, setWasTaskDiffActive] = useState(isTaskDiffActive);

  if (trackedThreadId !== threadId) {
    setTrackedThreadId(threadId);
    setPaths(null);
  }
  if (wasTaskDiffActive !== isTaskDiffActive) {
    setWasTaskDiffActive(isTaskDiffActive);
    if (!isTaskDiffActive) {
      setPaths(null);
    }
  }

  const apply = useCallback((nextPaths: readonly string[]) => {
    setPaths(new Set(nextPaths));
  }, []);
  const clear = useCallback(() => {
    setPaths(null);
  }, []);
  const fileFilter = useMemo<TaskDiffFileFilter | null>(
    () => (paths === null ? null : { paths, onClear: clear }),
    [clear, paths],
  );

  return { apply, clear, fileFilter };
}
