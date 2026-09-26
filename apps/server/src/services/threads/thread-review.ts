import { getEnvironment, getThread, type EnvironmentRow } from "@bb/db";
import {
  resolveTaskDiffTarget,
  type PromptInput,
  type Thread,
} from "@bb/domain";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { createThreadFromRequest } from "./thread-create.js";

type ThreadReviewDeps = LoggedPendingInteractionWorkSessionDeps;

function requireReviewSourceThread(
  deps: Pick<ThreadReviewDeps, "db">,
  sourceThreadId: string,
): Thread {
  const sourceThread = getThread(deps.db, sourceThreadId);
  if (!sourceThread || sourceThread.deletedAt !== null) {
    throw new ApiError(404, "thread_not_found", "Source thread not found");
  }
  if (sourceThread.archivedAt !== null) {
    throw new ApiError(
      400,
      "invalid_request",
      "Cannot review an archived source thread",
    );
  }
  return sourceThread;
}

function requireReviewSourceEnvironment(
  deps: Pick<ThreadReviewDeps, "db">,
  sourceThread: Thread,
): EnvironmentRow {
  const environment =
    sourceThread.environmentId === null
      ? null
      : getEnvironment(deps.db, sourceThread.environmentId);
  if (!environment) {
    throw new ApiError(
      400,
      "invalid_request",
      "Source thread must have an environment to review",
    );
  }
  if (!environment.isGitRepo) {
    throw new ApiError(
      409,
      "not_applicable",
      "Environment is not a git repository",
    );
  }
  if (environment.status !== "ready" || !environment.path) {
    throw new ApiError(
      400,
      "invalid_request",
      "Source thread must have a ready environment to review",
    );
  }
  return environment;
}

function isTooDeepParentThreadError(error: unknown): boolean {
  if (
    !(error instanceof ApiError) ||
    error.body.code !== "parent_thread_invalid"
  ) {
    return false;
  }
  const details = error.body.details as { reason?: string } | undefined;
  return details?.reason === "too_deep";
}

function buildReviewPromptInput(environment: EnvironmentRow): PromptInput[] {
  const targetInfo = resolveTaskDiffTarget(environment);
  const prompt =
    targetInfo.kind === "branch" && targetInfo.branchName !== null
      ? `/review ${targetInfo.baseBranch}..${targetInfo.branchName}`
      : "/review";
  return [{ type: "text", text: prompt, mentions: [] }];
}

export interface CreateThreadReviewRequest {
  sourceThreadId: string;
}

export async function createThreadReviewFromRequest(
  deps: ThreadReviewDeps,
  request: CreateThreadReviewRequest,
) {
  const sourceThread = requireReviewSourceThread(deps, request.sourceThreadId);
  const sourceEnvironment = requireReviewSourceEnvironment(deps, sourceThread);

  try {
    return await createThreadFromRequest(deps, {
      environment: { type: "reuse", environmentId: sourceEnvironment.id },
      input: buildReviewPromptInput(sourceEnvironment),
      origin: null,
      parentThreadId: sourceThread.id,
      projectId: sourceThread.projectId,
      startedOnBehalfOf: null,
    });
  } catch (error) {
    if (isTooDeepParentThreadError(error)) {
      throw new ApiError(
        409,
        "thread_hierarchy_too_deep",
        "Source thread's hierarchy is already at the maximum depth; cannot add a review thread",
      );
    }
    throw error;
  }
}
