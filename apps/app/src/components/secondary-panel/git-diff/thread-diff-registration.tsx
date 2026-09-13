import { createContext, useContext, type ReactNode } from "react";

export const ThreadDiffContentContext = createContext<ReactNode>(null);
export const ThreadDiffVisibilityContext = createContext(true);
export const ThreadTaskDiffContentContext = createContext<
  ((threadId: string) => ReactNode) | null
>(null);

export function ThreadDiffFixedTabContent() {
  return useContext(ThreadDiffContentContext);
}

export function ThreadTaskDiffFixedTabContent({
  threadId,
}: {
  threadId: string;
}) {
  return useContext(ThreadTaskDiffContentContext)?.(threadId) ?? null;
}

export function useThreadDiffVisible() {
  return useContext(ThreadDiffVisibilityContext);
}
