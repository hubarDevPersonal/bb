import { isRuntimeBusyThread, isUnreadDoneThread } from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";

export type StateThreadGroupKey = "action-needed" | "running" | "done";

export interface StateThreadGroup {
  key: StateThreadGroupKey;
  label: string;
  threads: ThreadListEntry[];
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
  thread: ThreadListEntry,
): StateThreadGroupKey | null {
  if (thread.hasPendingInteraction || isUnreadDoneThread(thread)) {
    return "action-needed";
  }
  if (isRuntimeBusyThread(thread)) {
    return "running";
  }
  if (
    thread.runtime.displayStatus === "idle" &&
    (thread.taskDiffStats?.changedFiles ?? 0) > 0
  ) {
    return "done";
  }
  return null;
}

export function buildStateThreadGroups(
  threads: readonly ThreadListEntry[],
): StateThreadGroup[] {
  const threadsByKey = new Map<StateThreadGroupKey, ThreadListEntry[]>();
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
