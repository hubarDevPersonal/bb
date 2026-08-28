import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDeferredPromise } from "@bb/test-helpers";
import { withGitRefMutationLock } from "../src/git-ref-mutation-lock.js";
import { ProcessLocalQueuedLockTimeoutError } from "../src/process-local-queued-lock.js";

function uniqueCommonDir(name: string): string {
  return path.join(os.tmpdir(), `bb-${name}-${randomUUID()}`);
}

function waitForLockContention(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

describe("git ref mutation lock", () => {
  it("serializes mutations for the same resolved common directory", async () => {
    const commonDir = uniqueCommonDir("git-ref-lock");
    const firstEntered = createDeferredPromise<void>();
    const releaseFirst = createDeferredPromise<void>();
    const first = withGitRefMutationLock(commonDir, async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
    });
    await firstEntered.promise;

    let secondEntered = false;
    const second = withGitRefMutationLock(
      `${commonDir}${path.sep}.`,
      async () => {
        secondEntered = true;
      },
    );
    await waitForLockContention();

    expect(secondEntered).toBe(false);

    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(secondEntered).toBe(true);
  });

  it("allows callers to bound how long they wait for the lock", async () => {
    const commonDir = uniqueCommonDir("git-ref-lock-timeout");
    const firstEntered = createDeferredPromise<void>();
    const releaseFirst = createDeferredPromise<void>();
    const first = withGitRefMutationLock(commonDir, async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
    });
    await firstEntered.promise;

    await expect(
      withGitRefMutationLock(commonDir, async () => undefined, {
        timeoutMs: 10,
      }),
    ).rejects.toBeInstanceOf(ProcessLocalQueuedLockTimeoutError);

    releaseFirst.resolve();
    await first;
  });
});
