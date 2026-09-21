import { createContext, useContext, type ReactNode } from "react";
import type { TaskDiffFileFilter } from "./TaskDiffPanelContent";

export const ThreadDiffContentContext = createContext<ReactNode>(null);
export const ThreadDiffVisibilityContext = createContext(true);
export const ThreadTaskDiffContentContext = createContext<
  ((threadId: string, fileFilter: TaskDiffFileFilter | null) => ReactNode) | null
>(null);
export const ThreadTaskDiffFileFilterContext =
  createContext<TaskDiffFileFilter | null>(null);

export function ThreadDiffFixedTabContent() {
  return useContext(ThreadDiffContentContext);
}

export function ThreadTaskDiffFixedTabContent({
  threadId,
}: {
  threadId: string;
}) {
  const fileFilter = useContext(ThreadTaskDiffFileFilterContext);
  return useContext(ThreadTaskDiffContentContext)?.(threadId, fileFilter) ?? null;
}

export function useThreadDiffVisible() {
  return useContext(ThreadDiffVisibilityContext);
}
