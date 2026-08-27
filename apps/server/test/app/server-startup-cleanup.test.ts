import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadServerConfig } from "@bb/config/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireServerLock,
  SERVER_LOCK_FILE_NAME,
} from "../../src/server-lock.js";

const mocks = vi.hoisted(() => {
  const startupError = new Error("test failure after listener startup");
  return {
    closeHttpServer: vi.fn((callback: (error?: Error) => void) => callback()),
    closeWebSockets: vi.fn(async () => undefined),
    injectWebSocket: vi.fn(() => {
      throw startupError;
    }),
    startupError,
    stopPlugins: vi.fn(async () => undefined),
  };
});

vi.mock("@hono/node-server", () => ({
  serve: vi.fn(() => ({ close: mocks.closeHttpServer })),
}));

vi.mock("../../src/server.js", () => ({
  createApp: vi.fn(() => ({
    app: { fetch: vi.fn() },
    closeWebSockets: mocks.closeWebSockets,
    injectWebSocket: mocks.injectWebSocket,
    pluginCatalogService: {
      startPeriodicRefresh: vi.fn(),
      stopPeriodicRefresh: vi.fn(),
    },
    pluginService: {
      bindSdk: vi.fn(),
      handleUncaughtException: vi.fn(() => false),
      start: vi.fn(async () => undefined),
      startPeriodicUpdateChecks: vi.fn(),
      stop: mocks.stopPlugins,
      stopPeriodicUpdateChecks: vi.fn(async () => undefined),
      sweepDueSchedules: vi.fn(async () => undefined),
    },
  })),
}));

import { runServer } from "../../src/start-server.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

describe("server startup cleanup", () => {
  it("closes bound resources before releasing the data-directory lock", async () => {
    const dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "bb-server-startup-cleanup-"),
    );
    tempDirs.push(dataDir);
    const serverConfig = loadServerConfig({
      env: {
        BB_DATA_DIR: dataDir,
        BB_HOST_DAEMON_PORT: "49162",
        BB_SERVER_PORT: "49161",
        NODE_ENV: "development",
      },
    });

    await expect(
      runServer(serverConfig, { lockOptions: { initialRetries: 0 } }),
    ).rejects.toBe(mocks.startupError);

    expect(mocks.closeHttpServer).toHaveBeenCalledOnce();
    expect(mocks.closeWebSockets).toHaveBeenCalledOnce();
    expect(mocks.stopPlugins).toHaveBeenCalledOnce();
    await expect(
      fs.stat(path.join(dataDir, `${SERVER_LOCK_FILE_NAME}.lock`)),
    ).rejects.toMatchObject({ code: "ENOENT" });

    const releaseLock = await acquireServerLock(dataDir, { initialRetries: 0 });
    await releaseLock();
  });
});
