import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireDataDirectoryLock } from "../src/data-directory-lock.js";

const LOCK_FILE_NAME = "test-process.lock";

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function createRecordingLogger() {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    logger: {
      warn: (_fields: Record<string, unknown>, message: string) => {
        warnings.push(message);
      },
      error: (_fields: Record<string, unknown>, message: string) => {
        errors.push(message);
      },
    },
    warnings,
    errors,
  };
}

describe("acquireDataDirectoryLock compromise handling", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-process-lock-"));
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("re-acquires a compromised lock instead of crashing the process", async () => {
    const { logger, warnings } = createRecordingLogger();
    const onLockLost = vi.fn();
    const release = await acquireDataDirectoryLock({
      dataDir,
      lockFileName: LOCK_FILE_NAME,
      ownerName: "Test process",
      staleMs: 2_000,
      initialRetries: 0,
      reacquireRetries: 25,
      retryIntervalMs: 100,
      logger,
      onLockLost,
    });
    const lockDirPath = path.join(dataDir, `${LOCK_FILE_NAME}.lock`);

    // Simulate the refresh failing: removing the lock dir makes the next
    // refresh tick compromise the held lock.
    await fs.rm(lockDirPath, { recursive: true, force: true });

    await waitFor(
      () => warnings.includes("Test process lock re-acquired after compromise"),
      10_000,
    );
    expect(warnings).toContain(
      "Test process lock compromised; re-acquiring without restarting the process",
    );
    expect(onLockLost).not.toHaveBeenCalled();
    await expect(fs.stat(lockDirPath)).resolves.toBeDefined();

    await release();
    await expect(fs.stat(lockDirPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 20_000);

  it("re-acquires when the lock dir survives until it becomes stale", async () => {
    const { logger, warnings } = createRecordingLogger();
    const onLockLost = vi.fn();
    const release = await acquireDataDirectoryLock({
      dataDir,
      lockFileName: LOCK_FILE_NAME,
      ownerName: "Test process",
      staleMs: 2_000,
      initialRetries: 0,
      reacquireRetries: 25,
      retryIntervalMs: 100,
      logger,
      onLockLost,
    });
    const lockDirPath = path.join(dataDir, `${LOCK_FILE_NAME}.lock`);

    // A foreign fresh mtime makes the next refresh tick compromise. Recovery
    // must retry until the directory ages past the stale window.
    const foreignMtime = new Date(Date.now() + 500);
    fsSync.utimesSync(lockDirPath, foreignMtime, foreignMtime);

    await waitFor(
      () => warnings.includes("Test process lock re-acquired after compromise"),
      15_000,
    );
    expect(onLockLost).not.toHaveBeenCalled();

    await release();
    await expect(fs.stat(lockDirPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }, 30_000);

  it("yields the data directory when another live process holds the lock", async () => {
    const { logger } = createRecordingLogger();
    const lockLostErrors: unknown[] = [];
    const release = await acquireDataDirectoryLock({
      dataDir,
      lockFileName: LOCK_FILE_NAME,
      ownerName: "Test process",
      staleMs: 2_000,
      initialRetries: 0,
      reacquireRetries: 3,
      retryIntervalMs: 100,
      logger,
      onLockLost: (error) => {
        lockLostErrors.push(error);
      },
    });
    const lockDirPath = path.join(dataDir, `${LOCK_FILE_NAME}.lock`);

    // A contender takes over and keeps its lock fresh, so compromise recovery
    // remains ELOCKED through its retry budget.
    await fs.rm(lockDirPath, { recursive: true, force: true });
    await fs.mkdir(lockDirPath);
    const keepContenderFresh = setInterval(() => {
      const now = new Date();
      try {
        fsSync.utimesSync(lockDirPath, now, now);
      } catch {
        // The directory only disappears once the test is over.
      }
    }, 200);

    try {
      await waitFor(() => lockLostErrors.length > 0, 15_000);
      expect(lockLostErrors[0]).toMatchObject({ code: "ELOCKED" });
    } finally {
      clearInterval(keepContenderFresh);
      await release().catch(() => undefined);
    }
  }, 30_000);
});
