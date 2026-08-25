import { beforeEach, describe, expect, it, vi } from "vitest";

const acquireDataDirectoryLock = vi.hoisted(() =>
  vi.fn(async () => async () => undefined),
);

vi.mock("@bb/process-utils/data-directory-lock", () => ({
  acquireDataDirectoryLock,
}));

import { acquireDaemonLock, DAEMON_LOCK_FILE_NAME } from "./lock.js";

describe("acquireDaemonLock", () => {
  beforeEach(() => {
    acquireDataDirectoryLock.mockClear();
  });

  it("maps the legacy retry budget without forwarding an ignored field", async () => {
    const logger = {
      warn: vi.fn(),
      error: vi.fn(),
    };
    const onLockLost = vi.fn();

    await acquireDaemonLock("/tmp/bb-daemon-lock-options", {
      logger,
      onLockLost,
      retries: 7,
      retryIntervalMs: 125,
      staleMs: 2_000,
    });

    expect(acquireDataDirectoryLock).toHaveBeenCalledWith({
      dataDir: "/tmp/bb-daemon-lock-options",
      initialRetries: 7,
      lockFileName: DAEMON_LOCK_FILE_NAME,
      logger,
      onLockLost,
      ownerName: "Daemon",
      reacquireRetries: 7,
      retryIntervalMs: 125,
      staleMs: 2_000,
    });
  });
});
