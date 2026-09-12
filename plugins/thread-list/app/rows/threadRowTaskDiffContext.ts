import { createContext, useContext } from "react";

const ThreadRowTaskDiffStatsContext = createContext(false);

export const ThreadRowTaskDiffStatsProvider =
  ThreadRowTaskDiffStatsContext.Provider;

export function useThreadRowTaskDiffStatsVisible(): boolean {
  return useContext(ThreadRowTaskDiffStatsContext);
}
