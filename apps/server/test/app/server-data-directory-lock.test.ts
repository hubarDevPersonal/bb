import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadServerConfig } from "@bb/config/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireServerLock } from "../../src/server-lock.js";

const initDb = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("initDb must not run while the server lock is held");
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
  });

  it("releases ownership when startup fails", async () => {
    const serverConfig = await createServerConfig();

    await expect(runServer(serverConfig)).rejects.toThrow(
      "initDb must not run while the server lock is held",
    );

    const releaseLock = await acquireServerLock(serverConfig.BB_DATA_DIR);
    await releaseLock();
  });
});
