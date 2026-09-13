import { resolveTaskDiffTarget } from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  requireEnvironment,
  requirePublicThread,
} from "../../services/lib/entity-lookup.js";
import { throwEnvironmentNotReady } from "../../services/lib/lifecycle-api-errors.js";
import {
  loadTaskDiffStatsResult,
  taskDiffStatsCacheKey,
} from "../../services/environments/task-diff-stats.js";
import { canApplyTaskDiffLocally } from "../../services/environments/main-checkout.js";

export function registerThreadTaskDiffRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  get(routes.taskDiff, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    if (thread.environmentId === null) {
      return context.json({
        outcome: "not_applicable",
        reason: "no_environment",
      });
    }

    const environment = requireEnvironment(deps.db, thread.environmentId);
    if (!environment.isGitRepo) {
      return context.json({
        outcome: "not_applicable",
        reason: "non_git_environment",
      });
    }
    if (environment.status !== "ready" || !environment.path) {
      throwEnvironmentNotReady(environment);
    }

    const targetInfo = resolveTaskDiffTarget(environment);
    const result = await deps.workspaceReadCaches.taskDiff.read({
      environmentId: environment.id,
      hostId: environment.hostId,
      key: taskDiffStatsCacheKey(targetInfo),
      load: () => loadTaskDiffStatsResult(deps, { environment, targetInfo }),
    });

    if (result.outcome === "unavailable") {
      return context.json({
        outcome: "unavailable",
        failure: result.failure,
      });
    }

    return context.json({
      outcome: "available",
      threadId: thread.id,
      environmentId: environment.id,
      kind: targetInfo.kind,
      target: targetInfo.target,
      baseBranch: targetInfo.baseBranch,
      branchName: targetInfo.branchName,
      stats: result.stats,
      canApplyLocally: canApplyTaskDiffLocally(deps, {
        environment,
        targetInfo,
      }),
    });
  });
}
