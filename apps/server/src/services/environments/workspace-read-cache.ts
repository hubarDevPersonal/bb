import type { EnvironmentChangeKind } from "@bb/domain";
import type { HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import type { ServerChangedMessage } from "../../ws/hub.js";
import type { TaskDiffStatsResult } from "./task-diff-stats.js";

const IGNORED_ENVIRONMENT_CHANGES: ReadonlySet<EnvironmentChangeKind> = new Set(
  ["metadata-changed", "thread-storage-changed"],
);

interface CacheEntry<TValue> {
  expiresAt: number;
  hostId: string;
  stale: boolean;
  value: TValue;
}

interface InFlightEntry<TValue> {
  hostId: string;
  promise: Promise<TValue>;
}

interface EnvironmentReadCacheReadArgs<TValue> {
  environmentId: string;
  hostId: string;
  key: string;
  load: () => Promise<TValue>;
}

interface EnvironmentReadCacheOptions<TValue> {
  now: () => number;
  ttlMs: number | ((value: TValue) => number);
}

export interface EnvironmentReadCachePeekResult<TValue> {
  stale: boolean;
  value: TValue;
}

interface EnvironmentReadCacheInvalidation {
  invalidateEnvironment(environmentId: string): void;
  invalidateHost(hostId: string): void;
}

export class EnvironmentReadCache<
  TValue,
> implements EnvironmentReadCacheInvalidation {
  private readonly entries = new Map<string, CacheEntry<TValue>>();
  private readonly inFlight = new Map<string, InFlightEntry<TValue>>();

  constructor(private readonly options: EnvironmentReadCacheOptions<TValue>) {}

  read(args: EnvironmentReadCacheReadArgs<TValue>): Promise<TValue> {
    const cacheKey = `${args.environmentId} ${args.key}`;
    const cached = this.entries.get(cacheKey);
    if (cached && !this.isStale(cached)) {
      return Promise.resolve(cached.value);
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      return pending.promise;
    }

    const promise = args.load().then(
      (value) => {
        if (this.inFlight.get(cacheKey)?.promise === promise) {
          this.inFlight.delete(cacheKey);
          const ttlMs =
            typeof this.options.ttlMs === "function"
              ? this.options.ttlMs(value)
              : this.options.ttlMs;
          this.entries.set(cacheKey, {
            expiresAt: this.options.now() + ttlMs,
            hostId: args.hostId,
            stale: false,
            value,
          });
        }
        return value;
      },
      (error: unknown) => {
        if (this.inFlight.get(cacheKey)?.promise === promise) {
          this.inFlight.delete(cacheKey);
        }
        throw error;
      },
    );
    this.inFlight.set(cacheKey, { hostId: args.hostId, promise });
    return promise;
  }

  peek(
    environmentId: string,
    key: string,
  ): EnvironmentReadCachePeekResult<TValue> | undefined {
    const cacheKey = `${environmentId} ${key}`;
    const cached = this.entries.get(cacheKey);
    if (!cached) {
      return undefined;
    }
    return { stale: this.isStale(cached), value: cached.value };
  }

  invalidateEnvironment(environmentId: string): void {
    const prefix = `${environmentId} `;
    this.dropWhere((cacheKey) => cacheKey.startsWith(prefix));
  }

  invalidateHost(hostId: string): void {
    this.dropWhere((_cacheKey, entryHostId) => entryHostId === hostId);
  }

  private isStale(entry: CacheEntry<TValue>): boolean {
    return entry.stale || entry.expiresAt <= this.options.now();
  }

  private dropWhere(
    predicate: (cacheKey: string, hostId: string) => boolean,
  ): void {
    for (const [cacheKey, entry] of this.entries) {
      if (predicate(cacheKey, entry.hostId)) {
        entry.stale = true;
      }
    }
    for (const [cacheKey, entry] of this.inFlight) {
      if (predicate(cacheKey, entry.hostId)) {
        this.inFlight.delete(cacheKey);
      }
    }
  }
}

const WORKSPACE_STATUS_CACHE_TTL_MS = 3_000;
const WORKSPACE_PULL_REQUEST_CACHE_TTL_MS = 10_000;
const WORKSPACE_TASK_DIFF_AVAILABLE_TTL_MS = 5 * 60_000;
const WORKSPACE_TASK_DIFF_UNAVAILABLE_TTL_MS = 10_000;

interface WorkspaceReadCachesDeps {
  hub: {
    onChangedMessage(
      listener: (message: ServerChangedMessage) => void,
    ): () => void;
  };
  now?: () => number;
}

export class WorkspaceReadCaches {
  readonly status: EnvironmentReadCache<
    HostDaemonOnlineRpcResult<"workspace.status">
  >;
  readonly pullRequest: EnvironmentReadCache<
    HostDaemonOnlineRpcResult<"workspace.pull_request">
  >;
  readonly taskDiff: EnvironmentReadCache<TaskDiffStatsResult>;

  constructor(deps: WorkspaceReadCachesDeps) {
    const now = deps.now ?? Date.now;
    this.status = new EnvironmentReadCache({
      now,
      ttlMs: WORKSPACE_STATUS_CACHE_TTL_MS,
    });
    this.pullRequest = new EnvironmentReadCache({
      now,
      ttlMs: WORKSPACE_PULL_REQUEST_CACHE_TTL_MS,
    });
    this.taskDiff = new EnvironmentReadCache<TaskDiffStatsResult>({
      now,
      ttlMs: (result) =>
        result.outcome === "available"
          ? WORKSPACE_TASK_DIFF_AVAILABLE_TTL_MS
          : WORKSPACE_TASK_DIFF_UNAVAILABLE_TTL_MS,
    });
    deps.hub.onChangedMessage((message) => {
      this.handleChangedMessage(message);
    });
  }

  private get caches(): EnvironmentReadCacheInvalidation[] {
    return [this.status, this.pullRequest, this.taskDiff];
  }

  invalidateEnvironment(environmentId: string): void {
    for (const cache of this.caches) {
      cache.invalidateEnvironment(environmentId);
    }
  }

  invalidateHost(hostId: string): void {
    for (const cache of this.caches) {
      cache.invalidateHost(hostId);
    }
  }

  private handleChangedMessage(message: ServerChangedMessage): void {
    if (message.entity === "environment") {
      const relevant = message.changes.some(
        (change) => !IGNORED_ENVIRONMENT_CHANGES.has(change),
      );
      if (!relevant) {
        return;
      }
      this.invalidateEnvironment(message.id);
      return;
    }
    if (
      message.entity === "host" &&
      message.changes.some(
        (change) =>
          change === "host-connected" || change === "host-disconnected",
      )
    ) {
      this.invalidateHost(message.id);
      return;
    }
    if (message.entity === "thread") {
      if (!message.changes.includes("status-changed")) {
        return;
      }
      const environmentId = message.metadata?.environmentId;
      if (environmentId) {
        this.taskDiff.invalidateEnvironment(environmentId);
      }
    }
  }
}
