import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadServerConfig } from "@bb/config/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireServerLock,
  SERVER_LOCK_FILE_NAME,
} from "../../src/server-lock.js";

const STARTUP_FAILURE = "test startup failure after initDb";
const initDb = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error(STARTUP_FAILURE);
  }),
);

vi.mock("../../src/db.js", () => ({ initDb }));

import { runServer } from "../../src/start-server.js";

const tempDirs: string[] = [];

async function createServerConfig() {
  const dataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "bb-server-data-directory-lock-"),
  );
  tempDirs.push(dataDir);
  return loadServerConfig({
    env: {
      BB_DATA_DIR: dataDir,
      BB_HOST_DAEMON_PORT: "49162",
      BB_SERVER_PORT: "49161",
      NODE_ENV: "development",
    },
  });
}

afterEach(async () => {
  initDb.mockClear();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("server data-directory ownership", () => {
  it("fails before opening SQLite when another server owns the data directory", async () => {
    const serverConfig = await createServerConfig();
    const releaseLock = await acquireServerLock(serverConfig.BB_DATA_DIR);

    try {
      await expect(runServer(serverConfig)).rejects.toThrow(
        `Server lock is already held for data directory ${serverConfig.BB_DATA_DIR}`,
      );
      expect(initDb).not.toHaveBeenCalled();
    } finally {
      await releaseLock();
    }
  }, 20_000);

  it("reclaims a fresh orphaned lock before starting and releases it after startup fails", async () => {
    const serverConfig = await createServerConfig();
    const lockPath = path.join(serverConfig.BB_DATA_DIR, SERVER_LOCK_FILE_NAME);
    const lockDirPath = `${lockPath}.lock`;
    await fs.writeFile(lockPath, "");
    await fs.mkdir(lockDirPath);
    // Keep the lock inside the 10-second stale window. A crashed server cannot
    // refresh it, so startup should wait briefly and then reclaim it.
    const nearlyStale = new Date(Date.now() - 8_000);
    await fs.utimes(lockDirPath, nearlyStale, nearlyStale);

    await expect(runServer(serverConfig)).rejects.toThrow(STARTUP_FAILURE);
    expect(initDb).toHaveBeenCalledOnce();

    const releaseLock = await acquireServerLock(serverConfig.BB_DATA_DIR);
    await releaseLock();
  }, 20_000);
});
