import path from "node:path";
import {
  withProcessLocalQueuedLocks,
  type ProcessLocalQueuedLockWork,
} from "./process-local-queued-lock.js";

type GitRefMutationLockWork<T> = ProcessLocalQueuedLockWork<T>;

interface GitRefMutationLockOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const gitRefMutationLockKeyPrefix = "git-ref-mutation:";

/**
 * Serializes bb-owned Git operations that mutate shared refs in one repository.
 * Git processes outside this host daemon do not participate, so callers must
 * still handle Git's ordinary concurrent-ref-update failures.
 */
export async function withGitRefMutationLock<T>(
  commonDir: string,
  work: GitRefMutationLockWork<T>,
  options: GitRefMutationLockOptions = {},
): Promise<T> {
  return withProcessLocalQueuedLocks({
    locks: [
      {
        key: `${gitRefMutationLockKeyPrefix}${path.resolve(commonDir)}`,
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
      },
    ],
    signal: options.signal,
    work,
  });
}
