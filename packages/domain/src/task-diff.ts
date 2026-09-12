import { z } from "zod";
import {
  resolveEnvironmentMergeBaseBranch,
  type Environment,
} from "./environment.js";
import type { WorkspaceDiffTarget } from "./thread-git-diff.js";

export const taskDiffStatsSchema = z.object({
  changedFiles: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type TaskDiffStats = z.infer<typeof taskDiffStatsSchema>;

export type TaskDiffTarget =
  | {
      kind: "branch";
      target: WorkspaceDiffTarget;
      baseBranch: string;
      branchName: string | null;
    }
  | {
      kind: "working_tree";
      target: WorkspaceDiffTarget;
      baseBranch: null;
      branchName: string | null;
    };

type ResolveTaskDiffTargetEnvironment = Pick<
  Environment,
  | "isWorktree"
  | "branchName"
  | "baseBranch"
  | "defaultBranch"
  | "mergeBaseBranch"
>;

export function resolveTaskDiffTarget(
  environment: ResolveTaskDiffTargetEnvironment,
): TaskDiffTarget {
  const mergeBaseBranch = resolveEnvironmentMergeBaseBranch(environment);
  if (environment.isWorktree && mergeBaseBranch) {
    return {
      kind: "branch",
      target: { type: "all", mergeBaseBranch },
      baseBranch: mergeBaseBranch,
      branchName: environment.branchName,
    };
  }
  return {
    kind: "working_tree",
    target: { type: "uncommitted" },
    baseBranch: null,
    branchName: environment.branchName,
  };
}
