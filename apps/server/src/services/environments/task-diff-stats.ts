import type { EnvironmentRow } from "@bb/db";
import type { TaskDiffStats, TaskDiffTarget } from "@bb/domain";
import type { WorkspaceResolutionFailure } from "@bb/host-daemon-contract/workspace";
import {
  COMMAND_TIMEOUT_MS,
  WORKSPACE_DIFF_MAX_FILES,
} from "../../constants.js";
import type { WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { requireWorkspaceCommandTarget } from "./workspace-command-target.js";

export type TaskDiffStatsResult =
  | { outcome: "available"; stats: TaskDiffStats }
  | { outcome: "unavailable"; failure: WorkspaceResolutionFailure };

interface LoadTaskDiffStatsResultArgs {
  environment: EnvironmentRow;
  targetInfo: TaskDiffTarget;
}

export function taskDiffStatsCacheKey(targetInfo: TaskDiffTarget): string {
  return JSON.stringify(targetInfo.target);
}

function sumTaskDiffStats(
  files: readonly { additions: number; deletions: number }[],
): TaskDiffStats {
  let insertions = 0;
  let deletions = 0;
  for (const file of files) {
    insertions += file.additions;
    deletions += file.deletions;
  }
  return { changedFiles: files.length, insertions, deletions };
}

export async function loadTaskDiffStatsResult(
  deps: WorkSessionDeps,
  args: LoadTaskDiffStatsResultArgs,
): Promise<TaskDiffStatsResult> {
  try {
    const target = requireWorkspaceCommandTarget(args.environment);
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "workspace.diffFiles",
        environmentId: target.environmentId,
        workspaceContext: target.workspaceContext,
        target: args.targetInfo.target,
        maxFiles: WORKSPACE_DIFF_MAX_FILES,
      },
    });
    if (result.outcome === "unavailable") {
      return result;
    }
    return { outcome: "available", stats: sumTaskDiffStats(result.files) };
  } catch (error) {
    return {
      outcome: "unavailable",
      failure: {
        code: "unknown",
        workspacePath: args.environment.path ?? "",
        message:
          error instanceof Error ? error.message : "Task diff is unavailable",
      },
    };
  }
}
