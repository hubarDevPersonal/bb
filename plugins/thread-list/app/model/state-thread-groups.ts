import type { SidebarThread } from "./sidebar-thread.js";
import { isRuntimeBusyThread, isUnreadDoneThread } from "./thread-activity.js";

export type StateThreadGroupKey = "action-needed" | "running" | "done";

export interface StateThreadGroup {
  key: StateThreadGroupKey;
  label: string;
  threads: SidebarThread[];
}

export const STATE_THREAD_GROUP_LABELS: Record<StateThreadGroupKey, string> = {
  "action-needed": "Action needed",
  running: "Running",
  done: "Done",
};

const STATE_THREAD_GROUP_ORDER: readonly StateThreadGroupKey[] = [
  "action-needed",
  "running",
  "done",
];

export function resolveStateThreadGroupKey(
  thread: SidebarThread,
): StateThreadGroupKey | null {
  if (thread.hasPendingInteraction || isUnreadDoneThread(thread)) {
    return "action-needed";
  }
  if (isRuntimeBusyThread(thread)) {
    return "running";
  }
  if (
    thread.runtimeStatus === "idle" &&
    (thread.experimental_taskDiffStats?.changedFiles ?? 0) > 0
  ) {
    return "done";
  }
  return null;
}

export function buildStateThreadGroups(
  threads: readonly SidebarThread[],
): StateThreadGroup[] {
  const threadsByKey = new Map<StateThreadGroupKey, SidebarThread[]>();
  for (const thread of threads) {
    const key = resolveStateThreadGroupKey(thread);
    if (key === null) continue;
    const existing = threadsByKey.get(key);
    if (existing) {
      existing.push(thread);
    } else {
      threadsByKey.set(key, [thread]);
    }
  }

  const groups: StateThreadGroup[] = [];
  for (const key of STATE_THREAD_GROUP_ORDER) {
    const groupThreads = threadsByKey.get(key);
    if (!groupThreads) continue;
    groups.push({
      key,
      label: STATE_THREAD_GROUP_LABELS[key],
      threads: groupThreads,
    });
  }
  return groups;
}
