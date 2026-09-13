import type { QueryClient } from "@tanstack/react-query";
import type { ThreadResponse } from "@bb/server-contract";
import { threadQueryKey, threadTaskDiffQueryKey } from "../queries/query-keys";
import { refetchThreadListsAfterComposerThreadCreate } from "./mutation-cache-effects";
import { invalidateEnvironmentActionQueries } from "./environment-cache-effects";

interface QueryClientArg {
  queryClient: QueryClient;
}

interface ApplyThreadReviewCreatedArgs extends QueryClientArg {
  thread: ThreadResponse;
}

export function applyThreadReviewCreated({
  queryClient,
  thread,
}: ApplyThreadReviewCreatedArgs): void {
  queryClient.setQueryData(threadQueryKey(thread.id), thread);
  refetchThreadListsAfterComposerThreadCreate({ queryClient });
}

interface InvalidateThreadTaskDiffAndWorkspaceStatusArgs extends QueryClientArg {
  environmentId: string;
  targetEnvironmentId: string;
  threadId: string;
}

export function invalidateThreadTaskDiffAndWorkspaceStatus({
  environmentId,
  queryClient,
  targetEnvironmentId,
  threadId,
}: InvalidateThreadTaskDiffAndWorkspaceStatusArgs): void {
  queryClient.invalidateQueries({
    queryKey: threadTaskDiffQueryKey(threadId),
  });
  invalidateEnvironmentActionQueries({ environmentId, queryClient });
  invalidateEnvironmentActionQueries({
    environmentId: targetEnvironmentId,
    queryClient,
  });
}
