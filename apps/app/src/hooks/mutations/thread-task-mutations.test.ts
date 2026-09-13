// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import type { ThreadApplyLocallyResponse } from "@bb/server-contract";
import { BbHttpError } from "@/lib/sdk";
import {
  getApplyLocallyErrorMessage,
  getApplyLocallySuccessToastTitle,
  getReviewErrorMessage,
} from "./thread-task-mutations";

function makeHttpError(code: string): BbHttpError {
  return new BbHttpError({
    body: { code, message: "server message" },
    code,
    message: "server message",
    status: 409,
  });
}

function makeApplyLocallyResponse(
  overrides: Partial<ThreadApplyLocallyResponse> = {},
): ThreadApplyLocallyResponse {
  return {
    commitSha: "abc123",
    conflictedFiles: [],
    outcome: "merged",
    targetBranch: "main",
    targetEnvironmentId: "env_main",
    ...overrides,
  } as ThreadApplyLocallyResponse;
}

describe("getApplyLocallyErrorMessage", () => {
  it.each([
    [
      "source_has_uncommitted_changes",
      "Commit the thread's changes before applying them locally.",
    ],
    [
      "dirty_target_checkout",
      "The main checkout has uncommitted changes. Commit or discard them first.",
    ],
    [
      "detached_head",
      "The main checkout is on a detached HEAD. Check out a branch first.",
    ],
    [
      "branch_not_found",
      "The thread's branch could not be found in the main checkout.",
    ],
    [
      "ignored_files_would_be_overwritten",
      "Applying would overwrite ignored files in the main checkout.",
    ],
    ["not_applicable", "Changes can't be applied locally for this thread."],
  ])("maps %s to a human message", (code, expected) => {
    expect(
      getApplyLocallyErrorMessage(makeHttpError(code), { baseBranch: null }),
    ).toBe(expected);
  });

  it("includes the base branch name for target_branch_mismatch", () => {
    expect(
      getApplyLocallyErrorMessage(makeHttpError("target_branch_mismatch"), {
        baseBranch: "main",
      }),
    ).toBe("Switch the main checkout to main before applying.");
  });

  it("falls back to a generic message when the base branch is unknown", () => {
    expect(
      getApplyLocallyErrorMessage(makeHttpError("target_branch_mismatch"), {
        baseBranch: null,
      }),
    ).toBe(
      "Switch the main checkout to the thread's base branch before applying.",
    );
  });

  it("falls back to the extracted server message for unknown codes", () => {
    expect(
      getApplyLocallyErrorMessage(makeHttpError("some_unmapped_code"), {
        baseBranch: null,
      }),
    ).toBe("server message");
  });
});

describe("getApplyLocallySuccessToastTitle", () => {
  it("reports up to date without needing the branch name", () => {
    expect(
      getApplyLocallySuccessToastTitle(
        makeApplyLocallyResponse({ outcome: "up_to_date" }),
        null,
      ),
    ).toBe("Already up to date");
  });

  it("reports fast-forward with the source and target branch", () => {
    expect(
      getApplyLocallySuccessToastTitle(
        makeApplyLocallyResponse({
          outcome: "fast_forwarded",
          targetBranch: "main",
        }),
        "bb/feature",
      ),
    ).toBe("Fast-forwarded bb/feature into main");
  });

  it("reports merges with the source and target branch", () => {
    expect(
      getApplyLocallySuccessToastTitle(
        makeApplyLocallyResponse({ outcome: "merged", targetBranch: "main" }),
        "bb/feature",
      ),
    ).toBe("Merged bb/feature into main");
  });

  it("returns null for conflicts so callers skip the toast", () => {
    expect(
      getApplyLocallySuccessToastTitle(
        makeApplyLocallyResponse({
          conflictedFiles: ["src/a.ts"],
          outcome: "conflict",
        }),
        "bb/feature",
      ),
    ).toBeNull();
  });
});

describe("getReviewErrorMessage", () => {
  it("maps not_applicable to a human message", () => {
    expect(getReviewErrorMessage(makeHttpError("not_applicable"))).toBe(
      "Review isn't available for this thread's environment.",
    );
  });

  it("maps thread_hierarchy_too_deep to a human message", () => {
    expect(
      getReviewErrorMessage(makeHttpError("thread_hierarchy_too_deep")),
    ).toBe("This thread is nested too deeply to start a review.");
  });

  it("falls back to the extracted server message for unknown codes", () => {
    expect(getReviewErrorMessage(makeHttpError("some_unmapped_code"))).toBe(
      "server message",
    );
  });
});
