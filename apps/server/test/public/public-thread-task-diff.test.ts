import { apiErrorSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  listQueuedCommands,
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

function seedThreadWithEnvironment(
  harness: TestAppHarness,
  environmentArgs: Partial<Parameters<typeof seedEnvironment>[1]> = {},
) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    ...environmentArgs,
  });
  const thread = seedThread(harness.deps, {
    environmentId: environment.id,
    projectId: project.id,
  });
  return { environment, host, project, thread };
}

async function answerDiffFiles(harness: TestAppHarness, environmentId: string) {
  const command = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "workspace.diffFiles" &&
      command.environmentId === environmentId,
  );
  await reportQueuedCommandSuccess(harness, command, {
    outcome: "available",
    files: [
      {
        path: "a.ts",
        previousPath: null,
        statusLetter: "M",
        additions: 3,
        deletions: 1,
        binary: false,
        origin: "tracked",
      },
      {
        path: "b.ts",
        previousPath: null,
        statusLetter: "A",
        additions: 5,
        deletions: 0,
        binary: false,
        origin: "untracked",
      },
    ],
    shortstat: "2 files changed",
    mergeBaseRef: "abc123",
    truncated: false,
  });
  return command;
}

describe("public thread task diff", () => {
  it("returns a branch-kind diff target for a worktree environment", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadWithEnvironment(harness, {
        isWorktree: true,
      });

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/task-diff`,
      );
      await answerDiffFiles(harness, environment.id);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "available",
        threadId: thread.id,
        environmentId: environment.id,
        kind: "branch",
        target: { type: "all", mergeBaseBranch: "main" },
        baseBranch: "main",
        branchName: "bb/test",
        stats: { changedFiles: 2, insertions: 8, deletions: 1 },
        canApplyLocally: false,
      });
    });
  });

  it("returns a working-tree diff target for a non-worktree environment", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadWithEnvironment(harness, {
        isWorktree: false,
      });

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/task-diff`,
      );
      await answerDiffFiles(harness, environment.id);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "available",
        threadId: thread.id,
        environmentId: environment.id,
        kind: "working_tree",
        target: { type: "uncommitted" },
        baseBranch: null,
        branchName: "bb/test",
        stats: { changedFiles: 2, insertions: 8, deletions: 1 },
        canApplyLocally: false,
      });
    });
  });

  it("returns canApplyLocally true when the project's main checkout is resolvable", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project, source } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: source.path,
        isWorktree: false,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        isWorktree: true,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });

      const responsePromise = harness.app.request(
        `/api/v1/threads/${thread.id}/task-diff`,
      );
      await answerDiffFiles(harness, environment.id);

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        outcome: "available",
        kind: "branch",
        canApplyLocally: true,
      });
    });
  });

  it("returns not_applicable for a non-git environment", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadWithEnvironment(harness, {
        isGitRepo: false,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/task-diff`,
      );
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "not_applicable",
        reason: "non_git_environment",
      });
    });
  });

  it("reuses the cached result and invalidates it on thread status-changed", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedThreadWithEnvironment(harness, {
        isWorktree: false,
      });

      const firstPromise = harness.app.request(
        `/api/v1/threads/${thread.id}/task-diff`,
      );
      await answerDiffFiles(harness, environment.id);
      await expect(readJson(await firstPromise)).resolves.toMatchObject({
        outcome: "available",
        stats: { changedFiles: 2, insertions: 8, deletions: 1 },
      });

      const second = await harness.app.request(
        `/api/v1/threads/${thread.id}/task-diff`,
      );
      await expect(readJson(second)).resolves.toMatchObject({
        outcome: "available",
        stats: { changedFiles: 2, insertions: 8, deletions: 1 },
      });
      expect(
        listQueuedCommands(harness, "workspace.diffFiles").filter(
          (command) =>
            "environmentId" in command &&
            command.environmentId === environment.id,
        ),
      ).toHaveLength(0);

      harness.hub.notifyThread(thread.id, ["status-changed"], {
        environmentId: environment.id,
      });

      const thirdPromise = harness.app.request(
        `/api/v1/threads/${thread.id}/task-diff`,
      );
      const secondCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diffFiles" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, secondCommand, {
        outcome: "available",
        files: [],
        shortstat: "",
        mergeBaseRef: null,
        truncated: false,
      });
      await expect(readJson(await thirdPromise)).resolves.toMatchObject({
        outcome: "available",
        stats: { changedFiles: 0, insertions: 0, deletions: 0 },
      });
    });
  });

  it("returns 404 for an unknown thread", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/threads/thr_missing/task-diff",
      );
      expect(response.status).toBe(404);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "thread_not_found",
      });
    });
  });

  it("returns not_applicable for a thread with no environment", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, { projectId: project.id });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/task-diff`,
      );
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "not_applicable",
        reason: "no_environment",
      });
    });
  });

  it("returns 409 for a not-ready environment", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadWithEnvironment(harness, {
        status: "provisioning",
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/task-diff`,
      );
      expect(response.status).toBe(409);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "environment_not_ready",
      });
    });
  });
});
