import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ThreadApplyLocallyResponse,
  ThreadResponse,
} from "@bb/server-contract";
import { BbHttpError, sdk } from "@/lib/sdk";
import { appToast } from "@/components/ui/app-toast";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  applyThreadReviewCreated,
  invalidateThreadTaskDiffAndWorkspaceStatus,
} from "../cache-owners/thread-task-cache-owner";
import { useSetThreadApplyConflictFiles } from "./thread-apply-conflict-store";

export interface ApplyThreadChangesLocallyRequest {
  baseBranch: string | null;
  branchName: string | null;
  environmentId: string;
}

export function threadReviewMutationKey(threadId: string) {
  return ["thread-task-review", threadId] as const;
}

export function threadApplyLocallyMutationKey(threadId: string) {
  return ["thread-task-apply", threadId] as const;
}

const APPLY_LOCALLY_ERROR_MESSAGES: Partial<Record<string, string>> = {
  branch_not_found:
    "The thread's branch could not be found in the main checkout.",
  detached_head:
    "The main checkout is on a detached HEAD. Check out a branch first.",
  dirty_target_checkout:
    "The main checkout has uncommitted changes. Commit or discard them first.",
  ignored_files_would_be_overwritten:
    "Applying would overwrite ignored files in the main checkout.",
  not_applicable: "Changes can't be applied locally for this thread.",
  source_has_uncommitted_changes:
    "Commit the thread's changes before applying them locally.",
};

export function getApplyLocallyErrorMessage(
  error: unknown,
  context: { baseBranch: string | null },
): string {
  if (error instanceof BbHttpError && error.code) {
    if (error.code === "target_branch_mismatch") {
      return context.baseBranch
        ? `Switch the main checkout to ${context.baseBranch} before applying.`
        : "Switch the main checkout to the thread's base branch before applying.";
    }
    const mapped = APPLY_LOCALLY_ERROR_MESSAGES[error.code];
    if (mapped) {
      return mapped;
    }
  }
  return getMutationErrorMessage({
    error,
    fallbackMessage: "Failed to apply changes locally.",
  });
}

export function getApplyLocallySuccessToastTitle(
  response: ThreadApplyLocallyResponse,
  branchName: string | null,
): string | null {
  const targetBranch = response.targetBranch;
  switch (response.outcome) {
    case "up_to_date":
      return "Already up to date";
    case "fast_forwarded":
      return branchName
        ? `Fast-forwarded ${branchName} into ${targetBranch}`
        : `Fast-forwarded into ${targetBranch}`;
    case "merged":
      return branchName
        ? `Merged ${branchName} into ${targetBranch}`
        : `Merged into ${targetBranch}`;
    case "conflict":
      return null;
  }
}

export function getReviewErrorMessage(error: unknown): string {
  if (error instanceof BbHttpError && error.code === "not_applicable") {
    return "Review isn't available for this thread's environment.";
  }
  if (
    error instanceof BbHttpError &&
    error.code === "thread_hierarchy_too_deep"
  ) {
    return "This thread is nested too deeply to start a review.";
  }
  return getMutationErrorMessage({
    error,
    fallbackMessage: "Failed to start review.",
  });
}

export function useRequestThreadReview(
  threadId: string,
  onCreated?: (thread: ThreadResponse) => void,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: threadReviewMutationKey(threadId),
    meta: {
      errorMessage: "Failed to start review.",
      showErrorToast: false,
    },
    mutationFn: (): Promise<ThreadResponse> => sdk.threads.review({ threadId }),
    onError: (error) => {
      appToast.error(getReviewErrorMessage(error));
    },
    onSuccess: (thread) => {
      applyThreadReviewCreated({ queryClient, thread });
      onCreated?.(thread);
    },
  });
}

export function useApplyThreadChangesLocally(threadId: string) {
  const queryClient = useQueryClient();
  const setConflictedFiles = useSetThreadApplyConflictFiles(threadId);

  return useMutation({
    mutationKey: threadApplyLocallyMutationKey(threadId),
    meta: {
      errorMessage: "Failed to apply changes locally.",
      showErrorToast: false,
    },
    mutationFn: (
      _request: ApplyThreadChangesLocallyRequest,
    ): Promise<ThreadApplyLocallyResponse> =>
      sdk.threads.applyLocally({ threadId }),
    onError: (error, variables) => {
      appToast.error(
        getApplyLocallyErrorMessage(error, {
          baseBranch: variables.baseBranch,
        }),
      );
    },
    onSuccess: (response, variables) => {
      invalidateThreadTaskDiffAndWorkspaceStatus({
        environmentId: variables.environmentId,
        queryClient,
        targetEnvironmentId: response.targetEnvironmentId,
        threadId,
      });
      if (response.outcome === "conflict") {
        setConflictedFiles(response.conflictedFiles);
        return;
      }
      const title = getApplyLocallySuccessToastTitle(
        response,
        variables.branchName,
      );
      if (title) {
        appToast.success(title);
      }
    },
  });
}
