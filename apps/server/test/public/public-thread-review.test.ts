import { archiveThread } from "@bb/db";
import { threadResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function seedReviewSource(
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

async function reviewThreadStart(harness: TestAppHarness, reviewId: string) {
  const queued = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "thread.start" && command.threadId === reviewId,
  );
  if (queued.command.type !== "thread.start") {
    throw new Error("Expected thread.start");
  }
  return queued.command;
}

describe("public thread review route", () => {
  it("creates a review child thread with a branch-scoped prompt", async () => {
    await withTestHarness(async (harness) => {
      const { environment, thread } = seedReviewSource(harness, {
        isWorktree: true,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/review`,
        { method: "POST" },
      );
      expect(response.status).toBe(201);
      const review = threadResponseSchema.parse(await readJson(response));
      expect(review.parentThreadId).toBe(thread.id);
      expect(review.environmentId).toBe(environment.id);
      expect(review.projectId).toBe(thread.projectId);

      const startCommand = await reviewThreadStart(harness, review.id);
      expect(startCommand.input).toEqual([
        { type: "text", text: "/review main..bb/test", mentions: [] },
      ]);
    });
  });

  it("creates a review child thread with a plain prompt for a working-tree kind", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedReviewSource(harness, { isWorktree: false });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/review`,
        { method: "POST" },
      );
      expect(response.status).toBe(201);
      const review = threadResponseSchema.parse(await readJson(response));

      const startCommand = await reviewThreadStart(harness, review.id);
      expect(startCommand.input).toEqual([
        { type: "text", text: "/review", mentions: [] },
      ]);
    });
  });

  it("returns 409 not_applicable for a non-git source environment", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedReviewSource(harness, {
        isGitRepo: false,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/review`,
        { method: "POST" },
      );
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "not_applicable",
      });
    });
  });

  it("rejects an archived source thread", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedReviewSource(harness);
      archiveThread(harness.db, harness.hub, thread.id);

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/review`,
        { method: "POST" },
      );
      expect(response.status).toBe(400);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
    });
  });

  it("returns 409 when the source thread's hierarchy is already at the depth limit", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const root = seedThread(harness.deps, { projectId: project.id });
      const middle1 = seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: root.id,
      });
      const middle2 = seedThread(harness.deps, {
        projectId: project.id,
        parentThreadId: middle1.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        parentThreadId: middle2.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/review`,
        { method: "POST" },
      );
      expect(response.status).toBe(409);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "thread_hierarchy_too_deep",
      });
    });
  });

  it("returns 404 for an unknown thread", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        "/api/v1/threads/thr_missing/review",
        { method: "POST" },
      );
      expect(response.status).toBe(404);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "thread_not_found",
      });
    });
  });
});
