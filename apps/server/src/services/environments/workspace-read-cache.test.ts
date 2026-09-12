import { createDeferredPromise, type DeferredPromise } from "@bb/test-helpers";
import { describe, expect, it } from "vitest";
import type { ServerChangedMessage } from "../../ws/hub.js";
import {
  EnvironmentReadCache,
  WorkspaceReadCaches,
} from "./workspace-read-cache.js";

function createClock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

function createCounter<T>(values: T[]) {
  const loads: DeferredPromise<T>[] = [];
  return {
    loads,
    load: () => {
      const next = createDeferredPromise<T>();
      loads.push(next);
      const value = values[loads.length - 1];
      if (value !== undefined) {
        next.resolve(value);
      }
      return next.promise;
    },
  };
}

function createFakeHub() {
  const listeners = new Set<(message: ServerChangedMessage) => void>();
  return {
    onChangedMessage(listener: (message: ServerChangedMessage) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(message: ServerChangedMessage) {
      for (const listener of listeners) {
        listener(message);
      }
    },
  };
}

const READ = { environmentId: "env-1", hostId: "host-1", key: "k" };

describe("EnvironmentReadCache", () => {
  it("shares one in-flight load between overlapping reads and reuses it inside the TTL", async () => {
    const clock = createClock();
    const cache = new EnvironmentReadCache<string>({
      now: clock.now,
      ttlMs: 3_000,
    });
    const counter = createCounter<string>([]);

    const first = cache.read({ ...READ, load: counter.load });
    const second = cache.read({ ...READ, load: counter.load });
    expect(counter.loads).toHaveLength(1);
    counter.loads[0]?.resolve("a");
    await expect(first).resolves.toBe("a");
    await expect(second).resolves.toBe("a");

    clock.advance(2_999);
    await expect(cache.read({ ...READ, load: counter.load })).resolves.toBe(
      "a",
    );
    expect(counter.loads).toHaveLength(1);

    clock.advance(1);
    const third = cache.read({ ...READ, load: counter.load });
    expect(counter.loads).toHaveLength(2);
    counter.loads[1]?.resolve("b");
    await expect(third).resolves.toBe("b");
  });

  it("keys reads by environment and by input key", async () => {
    const cache = new EnvironmentReadCache<string>({
      now: () => 0,
      ttlMs: 3_000,
    });
    const counter = createCounter(["a", "b", "c"]);

    await cache.read({ ...READ, load: counter.load });
    await cache.read({ ...READ, key: "other", load: counter.load });
    await cache.read({ ...READ, environmentId: "env-2", load: counter.load });
    await cache.read({ ...READ, load: counter.load });
    expect(counter.loads).toHaveLength(3);
  });

  it("does not cache a rejected load and lets the next read retry", async () => {
    const cache = new EnvironmentReadCache<string>({
      now: () => 0,
      ttlMs: 3_000,
    });
    const counter = createCounter<string>([]);

    const first = cache.read({ ...READ, load: counter.load });
    counter.loads[0]?.reject(new Error("boom"));
    await expect(first).rejects.toThrow("boom");

    const second = cache.read({ ...READ, load: counter.load });
    expect(counter.loads).toHaveLength(2);
    counter.loads[1]?.resolve("ok");
    await expect(second).resolves.toBe("ok");
  });

  it("detaches an in-flight probe on invalidation so its result is not reused", async () => {
    const cache = new EnvironmentReadCache<string>({
      now: () => 0,
      ttlMs: 3_000,
    });
    const counter = createCounter<string>([]);

    const stale = cache.read({ ...READ, load: counter.load });
    cache.invalidateEnvironment("env-1");

    const fresh = cache.read({ ...READ, load: counter.load });
    expect(counter.loads).toHaveLength(2);

    counter.loads[0]?.resolve("pre-change");
    counter.loads[1]?.resolve("post-change");
    await expect(stale).resolves.toBe("pre-change");
    await expect(fresh).resolves.toBe("post-change");

    await expect(cache.read({ ...READ, load: counter.load })).resolves.toBe(
      "post-change",
    );
    expect(counter.loads).toHaveLength(2);
  });

  it("invalidates only the entries that belong to the given host", async () => {
    const cache = new EnvironmentReadCache<string>({
      now: () => 0,
      ttlMs: 3_000,
    });
    const counter = createCounter(["a", "b", "c"]);

    await cache.read({ ...READ, load: counter.load });
    await cache.read({
      ...READ,
      environmentId: "env-2",
      hostId: "host-2",
      load: counter.load,
    });
    cache.invalidateHost("host-1");

    await cache.read({
      ...READ,
      environmentId: "env-2",
      hostId: "host-2",
      load: counter.load,
    });
    expect(counter.loads).toHaveLength(2);
    await cache.read({ ...READ, load: counter.load });
    expect(counter.loads).toHaveLength(3);
  });

  it("peeks a cached value without triggering a load", async () => {
    const clock = createClock();
    const cache = new EnvironmentReadCache<string>({
      now: clock.now,
      ttlMs: 3_000,
    });

    expect(cache.peek("env-1", "k")).toBeUndefined();

    const counter = createCounter<string>([]);
    const pending = cache.read({ ...READ, load: counter.load });
    expect(cache.peek("env-1", "k")).toBeUndefined();

    counter.loads[0]?.resolve("a");
    await pending;
    expect(cache.peek("env-1", "k")).toEqual({ stale: false, value: "a" });

    clock.advance(3_000);
    expect(cache.peek("env-1", "k")).toEqual({ stale: true, value: "a" });
  });

  it("marks a peeked value stale on invalidation instead of dropping it", async () => {
    const clock = createClock();
    const cache = new EnvironmentReadCache<string>({
      now: clock.now,
      ttlMs: 3_000,
    });
    const counter = createCounter(["a", "b"]);

    await cache.read({ ...READ, load: counter.load });
    expect(cache.peek("env-1", "k")).toEqual({ stale: false, value: "a" });

    cache.invalidateEnvironment("env-1");
    expect(cache.peek("env-1", "k")).toEqual({ stale: true, value: "a" });

    await expect(cache.read({ ...READ, load: counter.load })).resolves.toBe(
      "b",
    );
    expect(cache.peek("env-1", "k")).toEqual({ stale: false, value: "b" });
  });

  it("caches available and unavailable results with a different TTL", async () => {
    const clock = createClock();
    const cache = new EnvironmentReadCache<{ outcome: string }>({
      now: clock.now,
      ttlMs: (value) => (value.outcome === "available" ? 3_000 : 1_000),
    });
    const counter = createCounter([
      { outcome: "unavailable" },
      { outcome: "available" },
    ]);

    await cache.read({ ...READ, load: counter.load });
    clock.advance(1_000);
    expect(cache.peek("env-1", "k")?.stale).toBe(true);

    await expect(cache.read({ ...READ, load: counter.load })).resolves.toEqual({
      outcome: "available",
    });
    clock.advance(1_000);
    expect(cache.peek("env-1", "k")?.stale).toBe(false);
    clock.advance(2_000);
    expect(cache.peek("env-1", "k")?.stale).toBe(true);
    expect(counter.loads).toHaveLength(2);
  });
});

describe("WorkspaceReadCaches", () => {
  const statusResult = {
    outcome: "unavailable" as const,
    failure: {
      code: "unknown" as const,
      workspacePath: "/tmp/env-1",
      message: "no git",
    },
  };
  const pullRequestResult = { outcome: "absent" as const };

  async function primeBoth(caches: WorkspaceReadCaches) {
    const status = createCounter([statusResult, statusResult, statusResult]);
    const pullRequest = createCounter([
      pullRequestResult,
      pullRequestResult,
      pullRequestResult,
    ]);
    await caches.status.read({ ...READ, load: status.load });
    await caches.pullRequest.read({ ...READ, load: pullRequest.load });
    return {
      async readBoth() {
        await caches.status.read({ ...READ, load: status.load });
        await caches.pullRequest.read({ ...READ, load: pullRequest.load });
        return {
          status: status.loads.length,
          pullRequest: pullRequest.loads.length,
        };
      },
    };
  }

  it("drops both caches for an environment on work-status-changed and git-refs-changed", async () => {
    for (const change of ["work-status-changed", "git-refs-changed"] as const) {
      const hub = createFakeHub();
      const caches = new WorkspaceReadCaches({ hub, now: () => 0 });
      const primed = await primeBoth(caches);

      hub.emit({
        type: "changed",
        entity: "environment",
        id: "env-2",
        changes: [change],
      });
      expect(await primed.readBoth()).toEqual({ status: 1, pullRequest: 1 });

      hub.emit({
        type: "changed",
        entity: "environment",
        id: "env-1",
        changes: [change],
      });
      expect(await primed.readBoth()).toEqual({ status: 2, pullRequest: 2 });
    }
  });

  it("keeps cached reads across record-only environment changes", async () => {
    const hub = createFakeHub();
    const caches = new WorkspaceReadCaches({ hub, now: () => 0 });
    const primed = await primeBoth(caches);

    hub.emit({
      type: "changed",
      entity: "environment",
      id: "env-1",
      changes: ["metadata-changed", "thread-storage-changed"],
    });
    expect(await primed.readBoth()).toEqual({ status: 1, pullRequest: 1 });
  });

  it("drops cached reads for a host when that host connects or disconnects", async () => {
    const hub = createFakeHub();
    const caches = new WorkspaceReadCaches({ hub, now: () => 0 });
    const primed = await primeBoth(caches);

    hub.emit({
      type: "changed",
      entity: "host",
      id: "host-2",
      changes: ["host-connected"],
    });
    expect(await primed.readBoth()).toEqual({ status: 1, pullRequest: 1 });

    hub.emit({
      type: "changed",
      entity: "host",
      id: "host-1",
      changes: ["host-connected"],
    });
    expect(await primed.readBoth()).toEqual({ status: 2, pullRequest: 2 });
  });

  it("keeps a host's cached reads when only its provider model catalog changed", async () => {
    const hub = createFakeHub();
    const caches = new WorkspaceReadCaches({ hub, now: () => 0 });
    const primed = await primeBoth(caches);

    hub.emit({
      type: "changed",
      entity: "host",
      id: "host-1",
      changes: ["provider-model-catalog-changed"],
    });
    expect(await primed.readBoth()).toEqual({ status: 1, pullRequest: 1 });
  });

  it("drops both caches when a server-side mutation invalidates the environment or host", async () => {
    const hub = createFakeHub();
    const caches = new WorkspaceReadCaches({ hub, now: () => 0 });
    const primed = await primeBoth(caches);

    caches.invalidateEnvironment("env-2");
    caches.invalidateHost("host-2");
    expect(await primed.readBoth()).toEqual({ status: 1, pullRequest: 1 });

    caches.invalidateEnvironment("env-1");
    expect(await primed.readBoth()).toEqual({ status: 2, pullRequest: 2 });

    caches.invalidateHost("host-1");
    expect(await primed.readBoth()).toEqual({ status: 3, pullRequest: 3 });
  });

  it("invalidates only taskDiff for the thread's environment on status-changed", async () => {
    const hub = createFakeHub();
    const caches = new WorkspaceReadCaches({ hub, now: () => 0 });
    const primed = await primeBoth(caches);
    const taskDiffA = {
      outcome: "available" as const,
      stats: { changedFiles: 1, insertions: 1, deletions: 0 },
    };
    const taskDiffB = {
      outcome: "available" as const,
      stats: { changedFiles: 2, insertions: 2, deletions: 0 },
    };
    const taskDiff = createCounter([taskDiffA, taskDiffB]);
    await caches.taskDiff.read({ ...READ, load: taskDiff.load });

    hub.emit({
      type: "changed",
      entity: "thread",
      id: "thr-1",
      changes: ["title-changed"],
      metadata: { environmentId: "env-1" },
    });
    await expect(
      caches.taskDiff.read({ ...READ, load: taskDiff.load }),
    ).resolves.toBe(taskDiffA);
    expect(await primed.readBoth()).toEqual({ status: 1, pullRequest: 1 });

    hub.emit({
      type: "changed",
      entity: "thread",
      id: "thr-1",
      changes: ["status-changed"],
      metadata: { environmentId: "env-1" },
    });
    await expect(
      caches.taskDiff.read({ ...READ, load: taskDiff.load }),
    ).resolves.toBe(taskDiffB);
    expect(await primed.readBoth()).toEqual({ status: 1, pullRequest: 1 });
  });

  it("does not invalidate when the status-changed message carries no environmentId", async () => {
    const hub = createFakeHub();
    const caches = new WorkspaceReadCaches({ hub, now: () => 0 });
    const taskDiffA = {
      outcome: "available" as const,
      stats: { changedFiles: 1, insertions: 1, deletions: 0 },
    };
    const taskDiffB = {
      outcome: "available" as const,
      stats: { changedFiles: 2, insertions: 2, deletions: 0 },
    };
    const taskDiff = createCounter([taskDiffA, taskDiffB]);
    await caches.taskDiff.read({ ...READ, load: taskDiff.load });

    hub.emit({
      type: "changed",
      entity: "thread",
      id: "thr-1",
      changes: ["status-changed"],
    });
    await expect(
      caches.taskDiff.read({ ...READ, load: taskDiff.load }),
    ).resolves.toBe(taskDiffA);
  });

  it("does not invalidate on a thread task-diff-changed message", async () => {
    const hub = createFakeHub();
    const caches = new WorkspaceReadCaches({ hub, now: () => 0 });
    const taskDiffA = {
      outcome: "available" as const,
      stats: { changedFiles: 1, insertions: 1, deletions: 0 },
    };
    const taskDiff = createCounter([taskDiffA]);
    await caches.taskDiff.read({ ...READ, load: taskDiff.load });

    hub.emit({
      type: "changed",
      entity: "thread",
      id: "thr-1",
      changes: ["task-diff-changed"],
      metadata: { environmentId: "env-1" },
    });
    await expect(
      caches.taskDiff.read({ ...READ, load: taskDiff.load }),
    ).resolves.toBe(taskDiffA);
    expect(taskDiff.loads).toHaveLength(1);
  });
});
