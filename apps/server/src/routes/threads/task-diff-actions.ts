import { resolveTaskDiffTarget } from "@bb/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import {
  requireEnvironment,
  requirePublicThread,
} from "../../services/lib/entity-lookup.js";
import { throwEnvironmentNotReady } from "../../services/lib/lifecycle-api-errors.js";
import { resolveApplicableTaskDiffTarget } from "../../services/environments/main-checkout.js";
import { requireWorkspaceCommandTarget } from "../../services/environments/workspace-command-target.js";
import { callEnvironmentWorkspaceStatus } from "../../services/environments/workspace-status.js";
import { requireAvailableWorkspaceStatus } from "../../services/environments/workspace-rpc-results.js";
import { runLiveCommandAndWait } from "../../services/hosts/live-command-wait.js";
import { createThreadReviewFromRequest } from "../../services/threads/thread-review.js";
import { toThreadResponseFromThread } from "../../services/threads/thread-runtime-display.js";

const APPLY_BRANCH_CONFLICT_CODES = new Set([
  "detached_head",
  "dirty_target_checkout",
  "branch_not_found",
  "ignored_files_would_be_overwritten",
]);

function requireNotArchivedSourceThread(
  thread: { archivedAt: number | null },
  action: string,
): void {
  if (thread.archivedAt !== null) {
    throw new ApiError(
      400,
      "invalid_request",
      `Cannot ${action} an archived source thread`,
    );
  }
}

export function registerThreadTaskDiffActionRoutes(
  app: Hono,
  deps: AppDeps,
): void {
  const { post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  post(routes.review, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    requireNotArchivedSourceThread(thread, "review");
    const created = await createThreadReviewFromRequest(deps, {
      sourceThreadId: thread.id,
    });
    return context.json(
      toThreadResponseFromThread(deps, { thread: created }),
      201,
    );
  });

  post(routes.applyLocally, async (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    requireNotArchivedSourceThread(thread, "apply changes from");
    if (thread.environmentId === null) {
      throw new ApiError(409, "not_applicable", "Thread has no environment");
    }
    const environment = requireEnvironment(deps.db, thread.environmentId);
    if (!environment.isGitRepo) {
      throw new ApiError(
        409,
        "not_applicable",
        "Environment is not a git repository",
      );
    }
    if (environment.status !== "ready" || !environment.path) {
      throwEnvironmentNotReady(environment);
    }

    const targetInfo = resolveTaskDiffTarget(environment);
    const applicableTarget = resolveApplicableTaskDiffTarget(deps, {
      environment,
      targetInfo,
    });
    if (!applicableTarget) {
      throw new ApiError(
        409,
        "not_applicable",
        "Task diff cannot be applied locally",
      );
    }

    const sourceTarget = requireWorkspaceCommandTarget(environment);
    deps.workspaceReadCaches.invalidateEnvironment(environment.id);
    const statusResult = await deps.workspaceReadCaches.status.read({
      environmentId: environment.id,
      hostId: sourceTarget.hostId,
      key: JSON.stringify(sourceTarget.workspaceContext),
      load: () =>
        callEnvironmentWorkspaceStatus(deps, {
          environment,
          target: sourceTarget,
        }),
    });
    const workspaceStatus = requireAvailableWorkspaceStatus(statusResult);
    if (workspaceStatus.workingTree.hasUncommittedChanges) {
      throw new ApiError(
        409,
        "source_has_uncommitted_changes",
        "Thread workspace has uncommitted changes",
      );
    }

    const { mainCheckoutEnvironment, branchName } = applicableTarget;
    const mainTarget = requireWorkspaceCommandTarget(mainCheckoutEnvironment);
    deps.workspaceReadCaches.invalidateEnvironment(mainCheckoutEnvironment.id);
    const mainStatusResult = await deps.workspaceReadCaches.status.read({
      environmentId: mainCheckoutEnvironment.id,
      hostId: mainTarget.hostId,
      key: JSON.stringify(mainTarget.workspaceContext),
      load: () =>
        callEnvironmentWorkspaceStatus(deps, {
          environment: mainCheckoutEnvironment,
          target: mainTarget,
        }),
    });
    const mainWorkspaceStatus =
      requireAvailableWorkspaceStatus(mainStatusResult);
    const currentMainBranch = mainWorkspaceStatus.branch.currentBranch;
    if (
      currentMainBranch === null ||
      currentMainBranch !== targetInfo.baseBranch
    ) {
      throw new ApiError(
        409,
        "target_branch_mismatch",
        `Main checkout is on ${currentMainBranch ?? "a detached HEAD"}, but the task's base branch is ${targetInfo.baseBranch}`,
      );
    }
    const targetBranch = currentMainBranch;

    let result;
    try {
      result = await runLiveCommandAndWait(deps, {
        hostId: mainTarget.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "workspace.apply_branch",
          environmentId: mainTarget.environmentId,
          workspaceContext: mainTarget.workspaceContext,
          sourceBranch: branchName,
        },
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        APPLY_BRANCH_CONFLICT_CODES.has(error.body.code)
      ) {
        throw new ApiError(409, error.body.code, error.body.message);
      }
      throw error;
    }

    if (result.outcome !== "conflict") {
      deps.hub.notifyEnvironment(environment.id, ["work-status-changed"]);
      deps.hub.notifyEnvironment(mainCheckoutEnvironment.id, [
        "work-status-changed",
      ]);
    }

    return context.json({
      outcome: result.outcome,
      commitSha: result.commitSha,
      conflictedFiles: result.conflictedFiles,
      targetEnvironmentId: mainCheckoutEnvironment.id,
      targetBranch,
    });
  });
}
