export const WORKBENCH_SUBAGENTS_REALTIME_CHANNEL = "workbench-subagents";

export function workbenchSubagentsSignalParentThreadId(
  payload: unknown,
): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const parentThreadId = (payload as { parentThreadId?: unknown })
    .parentThreadId;
  return typeof parentThreadId === "string" ? parentThreadId : null;
}

export const WORKBENCH_MULTI_MODEL_MODE_REALTIME_CHANNEL =
  "workbench-multi-model-mode";

export function workbenchMultiModelModeSignalEnabled(
  payload: unknown,
): boolean | null {
  if (typeof payload !== "object" || payload === null) return null;
  const enabled = (payload as { enabled?: unknown }).enabled;
  return typeof enabled === "boolean" ? enabled : null;
}
