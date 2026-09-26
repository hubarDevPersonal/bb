import { setTimeout as sleep } from "node:timers/promises";
import { changedMessageSchema, type ThreadChangedMessage } from "@bb/domain";
import { threadListResponseSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import {
  listQueuedCommands,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
import {
  seedEnvironment,
  seedHost,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function diffFilesCommandsForEnvironment(
  harness: TestAppHarness,
  environmentId: string,
) {
  return listQueuedCommands(harness, "workspace.diffFiles").filter(
    (command) =>
      "environmentId" in command && command.environmentId === environmentId,
  );
}

async function answerNextDiffFiles(
  harness: TestAppHarness,
  environmentId: string,
  stats: { additions: number; deletions: number },
) {
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
        additions: stats.additions,
        deletions: stats.deletions,
        binary: false,
        origin: "tracked",
      },
    ],
    shortstat: "1 file changed",
    mergeBaseRef: null,
    truncated: false,
  });
}

async function waitForThreadMessage(
  socket: { messages: string[] },
  predicate: (message: ThreadChangedMessage) => boolean,
  timeoutMs = 1_000,
): Promise<ThreadChangedMessage> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const raw of socket.messages) {
      const message = changedMessageSchema.parse(JSON.parse(raw));
      if (message.entity === "thread" && predicate(message)) {
        return message;
      }
    }
    await sleep(10);
  }
  throw new Error("Timed out waiting for a thread-list message");
}

function hasTaskDiffChanged(
  socket: { messages: string[] },
  threadId: string,
): boolean {
  return socket.messages.some((raw) => {
    const message = changedMessageSchema.parse(JSON.parse(raw));
    return (
      message.entity === "thread" &&
      message.id === threadId &&
      message.changes.includes("task-diff-changed")
    );
  });
}

describe("public thread list task diff", () => {
  it("loads task diff once for two threads sharing an environment, notifies both, then serves from cache", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const threadA = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const threadB = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });

      const first = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
      );
      expect(first.status).toBe(200);
      const firstList = threadListResponseSchema.parse(await readJson(first));
      expect(firstList.map((entry) => entry.taskDiffStats)).toEqual([
        null,
        null,
      ]);

      await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diffFiles" &&
          command.environmentId === environment.id,
      );
      expect(
        diffFilesCommandsForEnvironment(harness, environment.id),
      ).toHaveLength(1);

      await answerNextDiffFiles(harness, environment.id, {
        additions: 2,
        deletions: 1,
      });

      await waitForThreadMessage(
        socket,
        (message) =>
          message.id === threadA.id &&
          message.changes.includes("task-diff-changed"),
      );
      await waitForThreadMessage(
        socket,
        (message) =>
          message.id === threadB.id &&
          message.changes.includes("task-diff-changed"),
      );

      const second = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
      );
      const secondList = threadListResponseSchema.parse(await readJson(second));
      for (const entry of secondList) {
        expect(entry.taskDiffStats).toEqual({
          changedFiles: 1,
          insertions: 2,
          deletions: 1,
        });
      }
      expect(
        diffFilesCommandsForEnvironment(harness, environment.id),
      ).toHaveLength(0);
    });
  });

  it("serves the stale value after invalidation and skips notification when the reload is unchanged", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
      });
      const socket = createMockHubSocket();
      harness.hub.subscribe(socket, { kind: "thread-list" });

      const firstPromise = harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
      );
      await answerNextDiffFiles(harness, environment.id, {
        additions: 2,
        deletions: 1,
      });
      await firstPromise;
      await waitForThreadMessage(
        socket,
        (message) =>
          message.id === thread.id &&
          message.changes.includes("task-diff-changed"),
      );
      socket.messages.length = 0;

      harness.hub.notifyEnvironment(environment.id, ["work-status-changed"]);

      const second = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
      );
      const secondList = threadListResponseSchema.parse(await readJson(second));
      expect(
        secondList.find((entry) => entry.id === thread.id)?.taskDiffStats,
      ).toEqual({ changedFiles: 1, insertions: 2, deletions: 1 });

      await answerNextDiffFiles(harness, environment.id, {
        additions: 2,
        deletions: 1,
      });

      await sleep(100);
      expect(hasTaskDiffChanged(socket, thread.id)).toBe(false);
    });
  });

  it("does not queue a reload for an archived thread, a not-ready environment, or a disconnected host", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      const readyEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/archived-thread-env",
      });
      const archivedThread = seedThread(harness.deps, {
        environmentId: readyEnvironment.id,
        projectId: project.id,
      });
      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${archivedThread.id}/archive-all`,
        { method: "POST" },
      );
      expect(archiveResponse.status).toBe(200);

      const provisioningEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/provisioning-thread-env",
        status: "provisioning",
      });
      seedThread(harness.deps, {
        environmentId: provisioningEnvironment.id,
        projectId: project.id,
      });

      const offlineHost = seedHost(harness.deps, {
        id: "host-task-diff-offline",
      });
      const offlineEnvironment = seedEnvironment(harness.deps, {
        hostId: offlineHost.id,
        projectId: project.id,
        path: "/tmp/offline-host-env",
      });
      seedThread(harness.deps, {
        environmentId: offlineEnvironment.id,
        projectId: project.id,
      });

      const response = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}`,
      );
      expect(response.status).toBe(200);
      const list = threadListResponseSchema.parse(await readJson(response));
      expect(list.some((entry) => entry.id === archivedThread.id)).toBe(true);

      await sleep(100);
      expect(listQueuedCommands(harness, "workspace.diffFiles")).toHaveLength(
        0,
      );
    });
  });
});
