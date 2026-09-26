// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import { makeWorkspaceStatus } from "@bb/test-helpers";
import type {
  ThreadApplyLocallyResponse,
  ThreadResponse,
  ThreadTaskDiffResponse,
} from "@bb/server-contract";
import type { EnvironmentStatusResponse } from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeThreadResponse as makeSharedThreadResponse } from "@/test/fixtures/thread-responses";
import {
  environmentWorkStatusQueryKey,
  environmentWorkStatusQueryKeyPrefix,
  threadQueryKey,
  threadTaskDiffQueryKey,
} from "@/hooks/queries/query-keys";
import {
  useThreadTaskActions,
  type UseThreadTaskActionsOptions,
} from "./useThreadTaskActions";

const mocks = vi.hoisted(() => ({
  applyLocally: vi.fn(),
  environmentStatus: vi.fn(),
  getThread: vi.fn(),
  review: vi.fn(),
  taskDiff: vi.fn(),
}));

vi.mock("@/lib/ws", () => ({
  wsManager: {
    getConnectionState: vi.fn(() => "connected"),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...actual,
    sdk: {
      environments: {
        status: mocks.environmentStatus,
      },
      threads: {
        applyLocally: mocks.applyLocally,
        get: mocks.getThread,
        review: mocks.review,
        taskDiff: mocks.taskDiff,
      },
    },
  };
});

const THREAD_ID = "thr_1";
const ENVIRONMENT_ID = "env_1";
const TARGET_ENVIRONMENT_ID = "env_main";

function makeThreadResponse(
  overrides: Partial<ThreadResponse> = {},
): ThreadResponse {
  return {
    ...makeSharedThreadResponse(),
    activeBackgroundAgentCount: 0,
    archivedAt: null,
    canSpawnChild: true,
    createdAt: 0,
    deletedAt: null,
    environmentId: ENVIRONMENT_ID,
    id: THREAD_ID,
    lastReadAt: null,
    latestAttentionAt: 0,
    originKind: null,
    originPluginId: null,
    parentThreadId: null,
    pinnedAt: null,
    projectId: "proj_1",
    providerId: "codex",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    sectionId: null,
    sourceThreadId: null,
    status: "idle",
    title: null,
    titleFallback: null,
    updatedAt: 0,
    visibility: "visible",
    ...overrides,
  };
}

function makeTaskDiffResponse(
  overrides: Partial<
    Extract<ThreadTaskDiffResponse, { outcome: "available" }>
  > = {},
): ThreadTaskDiffResponse {
  return {
    baseBranch: "main",
    branchName: "bb/feature",
    canApplyLocally: true,
    environmentId: ENVIRONMENT_ID,
    kind: "branch",
    outcome: "available",
    stats: { changedFiles: 1, deletions: 1, insertions: 1 },
    target: { type: "all", mergeBaseBranch: "main" },
    threadId: THREAD_ID,
    ...overrides,
  };
}

function makeWorkStatusResponse(
  hasUncommittedChanges = false,
): EnvironmentStatusResponse {
  return {
    outcome: "available",
    workspace: makeWorkspaceStatus({
      workingTree: {
        ...makeWorkspaceStatus().workingTree,
        hasUncommittedChanges,
      },
    }),
  };
}

function makeApplyLocallyResponse(
  overrides: Partial<ThreadApplyLocallyResponse> = {},
): ThreadApplyLocallyResponse {
  return {
    commitSha: "abc123",
    conflictedFiles: [],
    outcome: "merged",
    targetBranch: "main",
    targetEnvironmentId: TARGET_ENVIRONMENT_ID,
    ...overrides,
  } as ThreadApplyLocallyResponse;
}

function seedThreadTaskActionsCache(
  harness: ReturnType<typeof createQueryClientTestHarness>,
  args: { mergeBaseBranch?: string; threadId?: string } = {},
) {
  const threadId = args.threadId ?? THREAD_ID;
  harness.queryClient.setQueryData(
    threadQueryKey(threadId),
    makeThreadResponse(),
  );
  harness.queryClient.setQueryData(
    threadTaskDiffQueryKey(threadId),
    makeTaskDiffResponse(),
  );
  harness.queryClient.setQueryData(
    environmentWorkStatusQueryKey(ENVIRONMENT_ID, args.mergeBaseBranch ?? null),
    makeWorkStatusResponse(),
  );
}

function renderTaskActions(
  args: {
    harness?: ReturnType<typeof createQueryClientTestHarness>;
    options?: UseThreadTaskActionsOptions;
    seed?: boolean;
    threadId?: string;
  } = {},
) {
  const harness = args.harness ?? createQueryClientTestHarness();
  const threadId = args.threadId ?? THREAD_ID;
  if (args.seed ?? true) {
    seedThreadTaskActionsCache(harness, {
      mergeBaseBranch: args.options?.mergeBaseBranch,
      threadId,
    });
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <harness.wrapper>{children}</harness.wrapper>
  );
  const view = renderHook(() => useThreadTaskActions(threadId, args.options), {
    wrapper,
  });
  return { harness, ...view };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useThreadTaskActions", () => {
  it("populates the conflict dialog when apply reports a conflict", async () => {
    mocks.getThread.mockResolvedValue(makeThreadResponse());
    mocks.taskDiff.mockResolvedValue(makeTaskDiffResponse());
    mocks.environmentStatus.mockResolvedValue(makeWorkStatusResponse());
    mocks.applyLocally.mockResolvedValue(
      makeApplyLocallyResponse({
        conflictedFiles: ["src/a.ts", "src/b.ts"],
        outcome: "conflict",
      }),
    );

    const { result } = renderTaskActions();

    await waitFor(() => expect(result.current.canApply).toBe(true));

    await act(async () => {
      result.current.apply();
      await waitFor(() => expect(mocks.applyLocally).toHaveBeenCalled());
    });

    await waitFor(() => expect(result.current.conflictDialog.open).toBe(true));
    expect(result.current.conflictDialog.conflictedFiles).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("invalidates the task diff and both environments' workspace status on success", async () => {
    mocks.getThread.mockResolvedValue(makeThreadResponse());
    mocks.taskDiff.mockResolvedValue(makeTaskDiffResponse());
    mocks.environmentStatus.mockResolvedValue(makeWorkStatusResponse());
    mocks.applyLocally.mockResolvedValue(makeApplyLocallyResponse());

    const harness = createQueryClientTestHarness();
    harness.queryClient.setQueryData(
      environmentWorkStatusQueryKey(TARGET_ENVIRONMENT_ID, null),
      makeWorkStatusResponse(),
    );
    const invalidateSpy = vi.spyOn(harness.queryClient, "invalidateQueries");

    const { result } = renderTaskActions({ harness });
    await waitFor(() => expect(result.current.canApply).toBe(true));

    await act(async () => {
      result.current.apply();
      await waitFor(() => expect(mocks.applyLocally).toHaveBeenCalled());
    });

    await waitFor(() => {
      const calledKeys = invalidateSpy.mock.calls.map(
        (call) => call[0]?.queryKey,
      );
      expect(calledKeys).toContainEqual(threadTaskDiffQueryKey(THREAD_ID));
      expect(calledKeys).toContainEqual(
        environmentWorkStatusQueryKeyPrefix(ENVIRONMENT_ID),
      );
      expect(calledKeys).toContainEqual(
        environmentWorkStatusQueryKeyPrefix(TARGET_ENVIRONMENT_ID),
      );
    });
  });

  it("caches the reviewed thread and calls onReviewCreated instead of navigating itself", async () => {
    const reviewedThread = makeThreadResponse({
      id: "thr_review",
      parentThreadId: THREAD_ID,
      projectId: "proj_1",
    });
    mocks.getThread.mockResolvedValue(makeThreadResponse());
    mocks.taskDiff.mockResolvedValue(makeTaskDiffResponse());
    mocks.environmentStatus.mockResolvedValue(makeWorkStatusResponse());
    mocks.review.mockResolvedValue(reviewedThread);
    const onReviewCreated = vi.fn();

    const { harness, result } = renderTaskActions({
      options: { onReviewCreated },
    });
    await waitFor(() => expect(result.current.canReview).toBe(true));

    await act(async () => {
      result.current.review();
      await waitFor(() => expect(mocks.review).toHaveBeenCalled());
    });

    await waitFor(() => {
      expect(
        harness.queryClient.getQueryData(threadQueryKey("thr_review")),
      ).toEqual(reviewedThread);
    });
    expect(onReviewCreated).toHaveBeenCalledWith(reviewedThread);
  });

  it("blocks a second instance while the first instance's apply is pending", async () => {
    mocks.getThread.mockResolvedValue(makeThreadResponse());
    mocks.taskDiff.mockResolvedValue(makeTaskDiffResponse());
    mocks.environmentStatus.mockResolvedValue(makeWorkStatusResponse());
    const deferred = createDeferredPromise<ThreadApplyLocallyResponse>();
    mocks.applyLocally.mockReturnValue(deferred.promise);

    const harness = createQueryClientTestHarness();
    const first = renderTaskActions({ harness });
    const second = renderTaskActions({ harness });

    await waitFor(() => expect(first.result.current.canApply).toBe(true));
    await waitFor(() => expect(second.result.current.canApply).toBe(true));

    act(() => {
      first.result.current.apply();
    });

    await waitFor(() => expect(second.result.current.pending).toBe(true));
    expect(first.result.current.pending).toBe(true);

    await act(async () => {
      deferred.resolve(makeApplyLocallyResponse());
      await deferred.promise;
    });

    await waitFor(() => expect(second.result.current.pending).toBe(false));
  });

  it("ignores a second apply() call from the same instance while one is pending", async () => {
    mocks.getThread.mockResolvedValue(makeThreadResponse());
    mocks.taskDiff.mockResolvedValue(makeTaskDiffResponse());
    mocks.environmentStatus.mockResolvedValue(makeWorkStatusResponse());
    const deferred = createDeferredPromise<ThreadApplyLocallyResponse>();
    mocks.applyLocally.mockReturnValue(deferred.promise);

    const { result } = renderTaskActions();
    await waitFor(() => expect(result.current.canApply).toBe(true));

    act(() => {
      result.current.apply();
    });
    await waitFor(() => expect(result.current.pending).toBe(true));

    act(() => {
      result.current.apply();
    });

    await act(async () => {
      deferred.resolve(makeApplyLocallyResponse());
      await deferred.promise;
    });

    expect(mocks.applyLocally).toHaveBeenCalledTimes(1);
  });

  it("keeps Apply hidden until the workspace status has loaded", async () => {
    mocks.getThread.mockResolvedValue(makeThreadResponse());
    mocks.taskDiff.mockResolvedValue(makeTaskDiffResponse());
    const statusDeferred = createDeferredPromise<EnvironmentStatusResponse>();
    mocks.environmentStatus.mockReturnValue(statusDeferred.promise);

    const { result } = renderTaskActions({ seed: false });
    await waitFor(() => expect(result.current.canReview).toBe(true));
    expect(result.current.canApply).toBe(false);

    await act(async () => {
      statusDeferred.resolve(makeWorkStatusResponse());
      await statusDeferred.promise;
    });

    await waitFor(() => expect(result.current.canApply).toBe(true));
  });

  it("keeps Apply hidden when the workspace status is unavailable", async () => {
    mocks.getThread.mockResolvedValue(makeThreadResponse());
    mocks.taskDiff.mockResolvedValue(makeTaskDiffResponse());
    mocks.environmentStatus.mockResolvedValue({
      failure: {
        code: "unknown",
        message: "boom",
        workspacePath: "/workspace",
      },
      outcome: "unavailable",
    });

    const { result } = renderTaskActions({ seed: false });
    await waitFor(() => expect(result.current.canReview).toBe(true));
    await waitFor(() => expect(mocks.environmentStatus).toHaveBeenCalled());
    expect(result.current.canApply).toBe(false);
  });

  it("reads the workspace status keyed by the caller's merge base branch", async () => {
    mocks.environmentStatus.mockResolvedValue(makeWorkStatusResponse(false));
    const harness = createQueryClientTestHarness();
    harness.queryClient.setQueryData(
      threadQueryKey(THREAD_ID),
      makeThreadResponse(),
    );
    harness.queryClient.setQueryData(
      threadTaskDiffQueryKey(THREAD_ID),
      makeTaskDiffResponse(),
    );
    harness.queryClient.setQueryData(
      environmentWorkStatusQueryKey(ENVIRONMENT_ID, null),
      makeWorkStatusResponse(true),
    );
    harness.queryClient.setQueryData(
      environmentWorkStatusQueryKey(ENVIRONMENT_ID, "release/1.0"),
      makeWorkStatusResponse(false),
    );

    const { result } = renderTaskActions({
      harness,
      options: { mergeBaseBranch: "release/1.0" },
      seed: false,
    });

    await waitFor(() => expect(result.current.canApply).toBe(true));
  });
});
