import { archiveThread } from "@bb/db";
import { apiErrorSchema } from "@bb/server-contract";
import {
  makeWorkspaceStatus,
  makeWorkspaceWorkingTree,
} from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedApplyLocallySource(
  harness: TestAppHarness,
  environmentArgs: Partial<Parameters<typeof seedEnvironment>[1]> = {},
) {
  const { host } = seedHostSession(harness.deps);
  const { project, source } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
  });
  const mainCheckout = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: source.path,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    isWorktree: true,
    ...environmentArgs,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
  });
  return { environment, host, mainCheckout, project, thread };
}

async function answerCleanStatus(
  harness: TestAppHarness,
  environmentId: string,
) {
  const command = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "workspace.status" &&
      command.environmentId === environmentId,
  );
  await reportQueuedCommandSuccess(harness, command, {
    outcome: "available",
    workspaceStatus: makeWorkspaceStatus(),
  });
}

describe("public thread apply-locally route", () => {
  it("returns 409 not_applicable for a non-worktree source environment", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedApplyLocallySource(harness, { isWorktree: false });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/apply-locally`,
        { method: "POST" },
      );
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "not_applicable",
      });
    });
  });

  it("returns 409 when the source worktree has uncommitted changes", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedApplyLocallySource(harness);

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/apply-locally`,
        { method: "POST" },
      );
      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: makeWorkspaceStatus({
          workingTree: makeWorkspaceWorkingTree({
            hasUncommittedChanges: true,
            state: "dirty_uncommitted",
          }),
        }),
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "source_has_uncommitted_changes",
      });
    });
  });

  it("queues workspace.apply_branch against the main checkout and reports conflicts", async () => {
    await withTestHarness(async (harness) => {
      const { environment, mainCheckout, thread } =
        seedApplyLocallySource(harness);

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/apply-locally`,
        { method: "POST" },
      );
      await answerCleanStatus(harness, environment.id);
      await answerCleanStatus(harness, mainCheckout.id);

      const applyCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.apply_branch" &&
          command.environmentId === mainCheckout.id,
      );
      if (applyCommand.command.type !== "workspace.apply_branch") {
        throw new Error("Expected workspace.apply_branch");
      }
      expect(applyCommand.command.sourceBranch).toBe("bb/test");
      await reportQueuedCommandSuccess(harness, applyCommand, {
        outcome: "conflict",
        commitSha: null,
        conflictedFiles: ["src/a.ts"],
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "conflict",
        commitSha: null,
        conflictedFiles: ["src/a.ts"],
        targetEnvironmentId: mainCheckout.id,
        targetBranch: "main",
      });
    });
  });

  it("maps a dirty target checkout failure to 409", async () => {
    await withTestHarness(async (harness) => {
      const { environment, mainCheckout, thread } =
        seedApplyLocallySource(harness);

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/apply-locally`,
        { method: "POST" },
      );
      await answerCleanStatus(harness, environment.id);
      await answerCleanStatus(harness, mainCheckout.id);

      const applyCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.apply_branch" &&
          command.environmentId === mainCheckout.id,
      );
      await reportQueuedCommandError(harness, applyCommand, {
        errorCode: "dirty_target_checkout",
        errorMessage: "Cannot apply branch: checkout has uncommitted changes",
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "dirty_target_checkout",
      });
    });
  });

  it("returns 409 target_branch_mismatch when the main checkout is on a different branch", async () => {
    await withTestHarness(async (harness) => {
      const { environment, mainCheckout, thread } =
        seedApplyLocallySource(harness);

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/apply-locally`,
        { method: "POST" },
      );
      await answerCleanStatus(harness, environment.id);
      const mainStatusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === mainCheckout.id,
      );
      await reportQueuedCommandSuccess(harness, mainStatusCommand, {
        outcome: "available",
        workspaceStatus: makeWorkspaceStatus({
          branch: { currentBranch: "some-other-branch", defaultBranch: "main" },
        }),
      });

      const response = await responsePromise;
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "target_branch_mismatch",
      });
    });
  });

  it("rejects an archived source thread", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedApplyLocallySource(harness);
      archiveThread(harness.db, harness.hub, thread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/apply-locally`,
        { method: "POST" },
      );
      expect(response.status).toBe(400);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("returns 404 for an unknown thread", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/threads/thr_missing/apply-locally",
        { method: "POST" },
      );
      expect(response.status).toBe(404);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "thread_not_found",
      });
    });
  });
});
