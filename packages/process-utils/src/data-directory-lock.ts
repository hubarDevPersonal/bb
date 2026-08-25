import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import lockfile from "proper-lockfile";

// proper-lockfile refreshes the held lock's mtime while the holder is alive.
// A lock older than the stale window is therefore abandoned and reclaimable.
const DEFAULT_LOCK_STALE_MS = 10_000;
const DEFAULT_LOCK_RETRY_INTERVAL_MS = 1_000;
const DEFAULT_LOCK_ACQUIRE_RETRIES = 13;
// Each failed re-acquire cycle spans the full acquisition retry budget
// (~14s with defaults), so this cap bounds unlocked operation after a
// compromise to roughly five minutes before the process yields.
const LOCK_REACQUIRE_MAX_CYCLES = 20;

export interface DataDirectoryLockLogger {
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface AcquireDataDirectoryLockOptions {
  dataDir: string;
  lockFileName: string;
  /** Human-readable owner used in diagnostics, such as "Server". */
  ownerName: string;
  /** Lock is treated as stale once its mtime is older than this many ms. */
  staleMs?: number;
  /** Number of retries when the lock is first acquired. */
  initialRetries?: number;
  /** Number of retries when a compromised lock is re-acquired. */
  reacquireRetries?: number;
  /** Fixed delay between acquisition retries. */
  retryIntervalMs?: number;
  /** Receives lock lifecycle diagnostics. Defaults to the console. */
  logger?: DataDirectoryLockLogger;
  /** Called when the lock cannot be safely re-acquired. Defaults to exit(1). */
  onLockLost?: (error: unknown) => void;
}

export type ReleaseDataDirectoryLock = () => Promise<void>;

const consoleLockLogger: DataDirectoryLockLogger = {
  warn: (fields, message) => console.warn(message, fields),
  error: (fields, message) => console.error(message, fields),
};

function isErrorWithCode(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * Exclusively owns a named lock inside a data directory until the returned
 * release function runs or the process exits.
 */
export async function acquireDataDirectoryLock(
  options: AcquireDataDirectoryLockOptions,
): Promise<ReleaseDataDirectoryLock> {
  await fs.mkdir(options.dataDir, { recursive: true });

  const lockPath = path.join(options.dataDir, options.lockFileName);
  await fs.writeFile(lockPath, "", { encoding: "utf8", flag: "a" });

  // proper-lockfile creates a directory at `<path>.lock` to hold the lock.
  // Pass lockfilePath explicitly so exit cleanup does not depend on an
  // undocumented default.
  const lockDirPath = `${lockPath}.lock`;
  const staleMs = options.staleMs ?? DEFAULT_LOCK_STALE_MS;
  const retryIntervalMs =
    options.retryIntervalMs ?? DEFAULT_LOCK_RETRY_INTERVAL_MS;
  const initialRetries = options.initialRetries ?? DEFAULT_LOCK_ACQUIRE_RETRIES;
  const reacquireRetries =
    options.reacquireRetries ?? DEFAULT_LOCK_ACQUIRE_RETRIES;
  const logger = options.logger ?? consoleLockLogger;
  const onLockLost = options.onLockLost ?? (() => process.exit(1));

  let released = false;
  let reacquiring = false;
  let holdsLock = false;
  let release: ReleaseDataDirectoryLock | null = null;

  // A compromised lock (the periodic mtime refresh failed — e.g. a transient
  // EPERM/ENOENT after sleep or an FS hiccup) must not crash the process:
  // proper-lockfile's default handler throws from a timer callback. Re-acquire
  // in place instead. A still-ours lock dir ages past the stale window and is
  // retaken; a lock actively refreshed by another process stays ELOCKED, so
  // this owner yields the data directory. Persistent non-ELOCKED failures are
  // bounded so the process never runs unlocked indefinitely.
  function handleCompromised(error: Error): void {
    if (released || reacquiring) {
      return;
    }
    reacquiring = true;
    holdsLock = false;
    logger.warn(
      { err: error },
      `${options.ownerName} lock compromised; re-acquiring without restarting the process`,
    );
    void (async () => {
      try {
        for (let cycle = 1; !released; cycle += 1) {
          try {
            const reacquiredRelease =
              await lockDataDirectoryFile(reacquireRetries);
            if (released) {
              await reacquiredRelease().catch(() => undefined);
              return;
            }
            release = reacquiredRelease;
            holdsLock = true;
            logger.warn(
              {},
              `${options.ownerName} lock re-acquired after compromise`,
            );
            return;
          } catch (acquireError) {
            if (released) {
              return;
            }
            if (isErrorWithCode(acquireError, "ELOCKED")) {
              logger.error(
                { err: acquireError },
                `${options.ownerName} lock is held by another live process; yielding the data directory`,
              );
              onLockLost(acquireError);
              return;
            }
            if (cycle >= LOCK_REACQUIRE_MAX_CYCLES) {
              logger.error(
                { err: acquireError, cycle },
                `${options.ownerName} lock could not be re-acquired after repeated attempts; yielding the data directory`,
              );
              onLockLost(acquireError);
              return;
            }
            logger.error(
              { err: acquireError, cycle },
              `Re-acquiring the compromised ${options.ownerName.toLowerCase()} lock failed; retrying`,
            );
            // Unref'd so a pending retry never keeps a shutting-down process
            // alive.
            await sleep(retryIntervalMs, undefined, { ref: false });
          }
        }
      } finally {
        reacquiring = false;
      }
    })();
  }

  function lockDataDirectoryFile(
    retries: number,
  ): Promise<ReleaseDataDirectoryLock> {
    return lockfile.lock(lockPath, {
      realpath: false,
      stale: staleMs,
      retries: {
        retries,
        factor: 1,
        minTimeout: retryIntervalMs,
        maxTimeout: retryIntervalMs,
      },
      lockfilePath: lockDirPath,
      onCompromised: handleCompromised,
    });
  }

  try {
    release = await lockDataDirectoryFile(initialRetries);
  } catch (error) {
    if (isErrorWithCode(error, "ELOCKED")) {
      throw new Error(
        `${options.ownerName} lock is already held for data directory ${options.dataDir}`,
        { cause: error },
      );
    }
    throw error;
  }
  holdsLock = true;

  // Synchronous fallback: if the process exits before async release finishes,
  // remove the lock directory. Only do this while the lock is believed ours;
  // after a compromise the directory may belong to a different process.
  const onExit = () => {
    if (!holdsLock) {
      return;
    }
    try {
      fsSync.rmSync(lockDirPath, { recursive: true, force: true });
    } catch {
      // Best-effort — nothing useful can happen if this fails during exit.
    }
  };
  process.once("exit", onExit);

  return async () => {
    if (released) {
      return;
    }
    released = true;
    process.removeListener("exit", onExit);
    try {
      await release?.();
    } catch (error) {
      // A compromised lock is already dropped by proper-lockfile.
      if (!isErrorWithCode(error, "ERELEASED")) {
        throw error;
      }
    }
    holdsLock = false;
  };
}
