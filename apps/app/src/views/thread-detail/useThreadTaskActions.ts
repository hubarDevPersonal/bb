import { useCallback, useMemo } from "react";
import { useIsMutating } from "@tanstack/react-query";
import type { TaskDiffStats, ThreadRuntimeDisplayStatus } from "@bb/domain";
import type {
  ThreadResponse,
  ThreadTaskDiffResponse,
} from "@bb/server-contract";
import { useThread, useThreadTaskDiff } from "@/hooks/queries/thread-queries";
import { useEnvironmentWorkStatus } from "@/hooks/queries/environment-queries";
import {
  threadApplyLocallyMutationKey,
  threadReviewMutationKey,
  useApplyThreadChangesLocally,
  useRequestThreadReview,
} from "@/hooks/mutations/thread-task-mutations";
import {
  useSetThreadApplyConflictFiles,
  useThreadApplyConflictFiles,
} from "@/hooks/mutations/thread-apply-conflict-store";

export interface ThreadTaskActionsAvailability {
  canApply: boolean;
  canReview: boolean;
}

interface DeriveThreadTaskActionsAvailabilityArgs {
  archivedAt: number | null | undefined;
  displayStatus: ThreadRuntimeDisplayStatus | undefined;
  taskDiff: ThreadTaskDiffResponse | undefined;
  workspaceClean: boolean;
}

export function deriveThreadTaskActionsAvailability({
  archivedAt,
  displayStatus,
  taskDiff,
  workspaceClean,
}: DeriveThreadTaskActionsAvailabilityArgs): ThreadTaskActionsAvailability {
  if (
    archivedAt != null ||
    displayStatus !== "idle" ||
    !taskDiff ||
    taskDiff.outcome !== "available" ||
    taskDiff.stats.changedFiles === 0
  ) {
    return { canApply: false, canReview: false };
  }
  return {
    canApply: taskDiff.canApplyLocally && workspaceClean,
    canReview: true,
  };
}

export interface ThreadTaskActionsConflictDialogState {
  conflictedFiles: readonly string[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export interface ThreadTaskActionsState {
  apply: () => void;
  canApply: boolean;
  canReview: boolean;
  conflictDialog: ThreadTaskActionsConflictDialogState;
  pending: boolean;
  review: () => void;
  stats: TaskDiffStats | null;
}

export interface UseThreadTaskActionsOptions {
  mergeBaseBranch?: string;
  onReviewCreated?: (thread: ThreadResponse) => void;
}

export function useThreadTaskActions(
  threadId: string,
  options?: UseThreadTaskActionsOptions,
): ThreadTaskActionsState {
  const threadQuery = useThread(threadId);
  const thread = threadQuery.data;
  const taskDiffQuery = useThreadTaskDiff(threadId, {
    enabled:
      thread !== undefined &&
      thread.archivedAt === null &&
      thread.environmentId !== null,
  });
  const workStatusQuery = useEnvironmentWorkStatus(
    thread?.environmentId,
    options?.mergeBaseBranch,
    { enabled: thread?.environmentId != null },
  );
  const workspaceClean =
    workStatusQuery.data?.outcome === "available" &&
    !workStatusQuery.data.workspace.workingTree.hasUncommittedChanges;
  const reviewMutation = useRequestThreadReview(
    threadId,
    options?.onReviewCreated,
  );
  const applyMutation = useApplyThreadChangesLocally(threadId);
  const conflictedFiles = useThreadApplyConflictFiles(threadId);
  const setConflictedFiles = useSetThreadApplyConflictFiles(threadId);
  const pendingReviewCount = useIsMutating({
    mutationKey: threadReviewMutationKey(threadId),
  });
  const pendingApplyCount = useIsMutating({
    mutationKey: threadApplyLocallyMutationKey(threadId),
  });
  const hasPendingTaskAction = pendingReviewCount > 0 || pendingApplyCount > 0;

  const taskDiff = taskDiffQuery.data;
  const { canApply, canReview } = useMemo(
    () =>
      deriveThreadTaskActionsAvailability({
        archivedAt: thread?.archivedAt,
        displayStatus: thread?.runtime.displayStatus,
        taskDiff,
        workspaceClean,
      }),
    [
      taskDiff,
      thread?.archivedAt,
      thread?.runtime.displayStatus,
      workspaceClean,
    ],
  );

  const review = useCallback(() => {
    if (hasPendingTaskAction) {
      return;
    }
    reviewMutation.mutate();
  }, [hasPendingTaskAction, reviewMutation]);

  const apply = useCallback(() => {
    if (hasPendingTaskAction) {
      return;
    }
    const environmentId = thread?.environmentId;
    if (!environmentId || !taskDiff || taskDiff.outcome !== "available") {
      return;
    }
    applyMutation.mutate({
      baseBranch: taskDiff.baseBranch,
      branchName: taskDiff.branchName,
      environmentId,
    });
  }, [applyMutation, hasPendingTaskAction, taskDiff, thread?.environmentId]);

  const handleConflictDialogOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setConflictedFiles(null);
      }
    },
    [setConflictedFiles],
  );

  return {
    apply,
    canApply,
    canReview,
    conflictDialog: {
      conflictedFiles: conflictedFiles ?? [],
      onOpenChange: handleConflictDialogOpenChange,
      open: conflictedFiles !== null,
    },
    pending: hasPendingTaskAction,
    review,
    stats: taskDiff && taskDiff.outcome === "available" ? taskDiff.stats : null,
  };
}
