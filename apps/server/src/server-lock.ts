import {
  acquireDataDirectoryLock,
  type AcquireDataDirectoryLockOptions,
  type DataDirectoryLockLogger,
  type ReleaseDataDirectoryLock,
} from "@bb/process-utils/data-directory-lock";

export const SERVER_LOCK_FILE_NAME = "server.lock";

export type ServerLockTimingOptions = Pick<
  AcquireDataDirectoryLockOptions,
  "initialRetries" | "reacquireRetries" | "retryIntervalMs" | "staleMs"
>;

interface AcquireServerLockOptions extends ServerLockTimingOptions {
  logger?: DataDirectoryLockLogger;
  onLockLost?: (error: unknown) => void;
}

export function acquireServerLock(
  dataDir: string,
  options: AcquireServerLockOptions = {},
): Promise<ReleaseDataDirectoryLock> {
  return acquireDataDirectoryLock({
    dataDir,
    lockFileName: SERVER_LOCK_FILE_NAME,
    ownerName: "Server",
    ...options,
  });
}
