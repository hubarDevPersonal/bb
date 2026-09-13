import type { HostDaemonCommandResult } from "@bb/host-daemon-contract";
import {
  type CommandDispatchOptions,
  type CommandOf,
} from "../command-dispatch-support.js";
import { requireResolvedWorkspaceForCommand } from "../workspace-resolution.js";

export async function squashMerge(
  command: CommandOf<"workspace.squash_merge">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.squash_merge">> {
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    requireGit: true,
    requireManagedWorktree: true,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  const result = await entry.workspace.squashMerge({
    targetBranch: command.targetBranch,
    commitMessage: command.commitMessage,
  });
  return {
    merged: result.merged,
    commitSha: result.commitSha,
    commitSubject: result.commitSubject,
  };
}

export async function applyBranch(
  command: CommandOf<"workspace.apply_branch">,
  options: CommandDispatchOptions,
): Promise<HostDaemonCommandResult<"workspace.apply_branch">> {
  const entry = await requireResolvedWorkspaceForCommand({
    dataDir: options.dataDir,
    environmentId: command.environmentId,
    requireGit: true,
    runtimeManager: options.runtimeManager,
    workspaceContext: command.workspaceContext,
  });
  return entry.workspace.applyBranch({ sourceBranch: command.sourceBranch });
}
