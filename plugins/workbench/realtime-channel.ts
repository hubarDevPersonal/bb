export const WORKBENCH_SUBAGENTS_REALTIME_CHANNEL = "workbench-subagents";

export function workbenchSubagentsSignalParentThreadId(
  payload: unknown,
): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const parentThreadId = (payload as { parentThreadId?: unknown })
    .parentThreadId;
  return typeof parentThreadId === "string" ? parentThreadId : null;
}
