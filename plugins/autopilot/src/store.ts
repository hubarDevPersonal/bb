import type { Tracked } from "./lifecycle.js";

export interface KvLike {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
}

export interface AutopilotEvent {
  at: number;
  kind: string;
  taskKey: string;
  detail: string;
}

const KEYS = {
  tracked: "tracked",
  skipped: "skipped",
  paused: "paused",
  events: "events",
  lastPlannerAt: "lastPlannerAt",
  emptyPlannerRuns: "emptyPlannerRuns",
} as const;

const MAX_EVENTS = 200;
const MAX_SKIPPED = 500;

export class AutopilotStore {
  tracked: Tracked[] = [];
  skipped: string[] = [];
  paused = false;
  events: AutopilotEvent[] = [];
  lastPlannerAt = 0;
  emptyPlannerRuns = 0;

  constructor(private readonly kv: KvLike) {}

  async load(): Promise<void> {
    this.tracked = (await this.kv.get<Tracked[]>(KEYS.tracked)) ?? [];
    this.skipped = (await this.kv.get<string[]>(KEYS.skipped)) ?? [];
    this.paused = (await this.kv.get<boolean>(KEYS.paused)) ?? false;
    this.events = (await this.kv.get<AutopilotEvent[]>(KEYS.events)) ?? [];
    this.lastPlannerAt = (await this.kv.get<number>(KEYS.lastPlannerAt)) ?? 0;
    this.emptyPlannerRuns = (await this.kv.get<number>(KEYS.emptyPlannerRuns)) ?? 0;
  }

  byThread(threadId: string): Tracked | null {
    return this.tracked.find((t) => t.threadId === threadId) ?? null;
  }

  byTask(taskId: string): Tracked | null {
    return this.tracked.find((t) => t.taskId === taskId) ?? null;
  }

  async track(record: Tracked): Promise<void> {
    this.tracked = [...this.tracked.filter((t) => t.taskId !== record.taskId), record];
    await this.kv.set(KEYS.tracked, this.tracked);
  }

  async update(taskId: string, patch: Partial<Tracked>): Promise<void> {
    this.tracked = this.tracked.map((t) => (t.taskId === taskId ? { ...t, ...patch } : t));
    await this.kv.set(KEYS.tracked, this.tracked);
  }

  async untrack(taskId: string): Promise<void> {
    this.tracked = this.tracked.filter((t) => t.taskId !== taskId);
    await this.kv.set(KEYS.tracked, this.tracked);
  }

  async skip(taskId: string): Promise<void> {
    this.skipped = [...this.skipped.filter((id) => id !== taskId), taskId].slice(-MAX_SKIPPED);
    await this.kv.set(KEYS.skipped, this.skipped);
  }

  async unskip(taskId: string): Promise<void> {
    this.skipped = this.skipped.filter((id) => id !== taskId);
    await this.kv.set(KEYS.skipped, this.skipped);
  }

  async setPaused(paused: boolean): Promise<void> {
    this.paused = paused;
    await this.kv.set(KEYS.paused, paused);
  }

  async setLastPlannerAt(at: number): Promise<void> {
    this.lastPlannerAt = at;
    await this.kv.set(KEYS.lastPlannerAt, at);
  }

  async setEmptyPlannerRuns(runs: number): Promise<void> {
    if (this.emptyPlannerRuns === runs) return;
    this.emptyPlannerRuns = runs;
    await this.kv.set(KEYS.emptyPlannerRuns, runs);
  }

  async log(event: Omit<AutopilotEvent, "at">): Promise<void> {
    this.events = [...this.events, { at: Date.now(), ...event }].slice(-MAX_EVENTS);
    await this.kv.set(KEYS.events, this.events);
  }
}
