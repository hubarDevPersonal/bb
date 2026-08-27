import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireDataDirectoryLock } from "../src/data-directory-lock.js";

vi.mock("proper-lockfile", () => ({
  default: { lock: vi.fn() },
}));

const mockedLock = vi.mocked(lockfile.lock);
const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { force: true, recursive: true })),
  );
});

describe("data-directory lock release", () => {
  it("disarms exit cleanup when the underlying release fails", async () => {
    const dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "bb-process-lock-release-"),
    );
    tempDirs.push(dataDir);
    const releaseError = new Error("rmdir failed");
    const underlyingRelease = vi.fn(async () => {
      throw releaseError;
    });
    mockedLock.mockResolvedValue(underlyingRelease);
    const listenersBefore = new Set(process.listeners("exit"));
    const release = await acquireDataDirectoryLock({
      dataDir,
      lockFileName: "test.lock",
      ownerName: "Test process",
    });
    const addedExitListener = process
      .listeners("exit")
      .find((listener) => !listenersBefore.has(listener));
    expect(addedExitListener).toBeDefined();
    const lockDirPath = path.join(dataDir, "test.lock.lock");
    await fs.mkdir(lockDirPath);

    await expect(release()).rejects.toBe(releaseError);
    expect(process.listeners("exit")).not.toContain(addedExitListener);
    await expect(release()).rejects.toBe(releaseError);
    expect(underlyingRelease).toHaveBeenCalledOnce();

    addedExitListener?.(0);
    await expect(fs.stat(lockDirPath)).resolves.toBeDefined();
  });
});
