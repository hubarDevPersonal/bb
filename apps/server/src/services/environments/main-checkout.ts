import {
  findProjectEnvironmentByHostPath,
  getProjectSourceByHost,
  type DbConnection,
} from "@bb/db";
import type { Environment, TaskDiffTarget } from "@bb/domain";

interface ResolveMainCheckoutEnvironmentArgs {
  hostId: string;
  projectId: string;
}

export function resolveMainCheckoutEnvironment(
  deps: { db: DbConnection },
  args: ResolveMainCheckoutEnvironmentArgs,
): Environment | null {
  const source = getProjectSourceByHost(deps.db, args.projectId, args.hostId);
  if (!source) {
    return null;
  }
  const environment = findProjectEnvironmentByHostPath(
    deps.db,
    args.projectId,
    args.hostId,
    source.path,
  );
  if (
    !environment ||
    environment.status !== "ready" ||
    environment.isWorktree
  ) {
    return null;
  }
  return environment;
}

interface ResolveApplicableTaskDiffTargetArgs {
  environment: Pick<Environment, "hostId" | "isWorktree" | "projectId">;
  targetInfo: Pick<TaskDiffTarget, "branchName" | "kind">;
}

export interface ApplicableTaskDiffTarget {
  branchName: string;
  mainCheckoutEnvironment: Environment;
}

export function resolveApplicableTaskDiffTarget(
  deps: { db: DbConnection },
  args: ResolveApplicableTaskDiffTargetArgs,
): ApplicableTaskDiffTarget | null {
  if (args.targetInfo.kind !== "branch") {
    return null;
  }
  if (!args.environment.isWorktree) {
    return null;
  }
  if (args.targetInfo.branchName === null) {
    return null;
  }
  const mainCheckoutEnvironment = resolveMainCheckoutEnvironment(deps, {
    hostId: args.environment.hostId,
    projectId: args.environment.projectId,
  });
  if (!mainCheckoutEnvironment) {
    return null;
  }
  return {
    branchName: args.targetInfo.branchName,
    mainCheckoutEnvironment,
  };
}

export function canApplyTaskDiffLocally(
  deps: { db: DbConnection },
  args: ResolveApplicableTaskDiffTargetArgs,
): boolean {
  return resolveApplicableTaskDiffTarget(deps, args) !== null;
}
