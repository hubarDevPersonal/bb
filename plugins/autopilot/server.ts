import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  DEFAULT_POLICY,
  evaluateBudget,
  type BudgetPolicy,
  type BudgetVerdict,
  type ProviderUsageLike,
} from "./src/budget.js";
import { registerAutopilotCli } from "./src/cli.js";
import { decide, type LifecycleAction, type Tracked } from "./src/lifecycle.js";
import { isPlannerDescription, pickNext, prefixFor, sourceRepos } from "./src/picker.js";
import {
  PLANNER_TASK_TITLE,
  continuePrompt,
  nudgePrompt,
  plannerInstructions,
  plannerTaskDescription,
  verifierInstructions,
  workerInstructions,
} from "./src/prompts.js";
import { AutopilotStore, type AutopilotEvent } from "./src/store.js";
import { TasksClient, type TaskPreset, type TaskRecord } from "./src/tasks-client.js";

const DEFAULT_SOURCES = [
  "fund: docs/hedge/03-roadmap.md, learn/README.md, learn/questions.md",
  "GrowthOS: plan/tracks.md",
].join("\n");

const USAGE_CACHE_MS = 60_000;
const STALE_MS = 45 * 60_000;
const PLANNER_COOLDOWN_MS = 3 * 60 * 60_000;

export interface AutopilotRuntime {
  store: AutopilotStore;
  tick(reason: string): Promise<string[]>;
  budgetFor(providerId: string, model: string | null): Promise<BudgetVerdict>;
  setup(input: { provider?: string; model?: string }): Promise<string[]>;
  recheck(): Promise<void>;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    enabled: {
      type: "boolean",
      label: "Autopilot enabled",
      description:
        "Start queued `auto` tasks on its own and keep them moving. Off stops new work; running threads finish their turn.",
      default: true,
    },
    fiveHourPercent: {
      type: "number",
      label: "Five-hour window budget, %",
      description:
        "Autopilot pauses its threads when the five-hour window reaches this share and resumes them after the reset. The rest is yours.",
      default: DEFAULT_POLICY.fiveHourPercent,
    },
    weeklyPercent: {
      type: "number",
      label: "Weekly window budget, %",
      default: DEFAULT_POLICY.weeklyPercent,
    },
    hardStopMarginPercent: {
      type: "number",
      label: "Hard-stop margin, %",
      description:
        "A running autopilot turn that pushes usage this far past the budget is stopped and parked until the window resets.",
      default: 15,
    },
    maxParallel: {
      type: "number",
      label: "Parallel autopilot tasks",
      default: 1,
    },
    maxAttempts: {
      type: "number",
      label: "Attempts per task before asking you",
      default: 3,
    },
    label: {
      type: "string",
      label: "Queue label",
      description: "Tasks with this label and status todo form the queue.",
      default: "auto",
    },
    workerPreset: {
      type: "string",
      label: "Worker preset name",
      default: "Autopilot worker",
    },
    verifierPreset: {
      type: "string",
      label: "Verifier preset name",
      default: "Autopilot verifier",
    },
    plannerProject: {
      type: "string",
      label: "Planner tracker project prefix",
      description:
        "Where the planner task is created when the queue runs dry, e.g. GROW. Empty disables the planner.",
      default: "",
    },
    plannerSources: {
      type: "string",
      label: "Roadmap sources for the planner",
      description: 'One per line: "<repo>: <files>".',
      experimental_multiline: true,
      default: DEFAULT_SOURCES,
    },
    plannerMaxTasks: {
      type: "number",
      label: "Max tasks per planner run",
      default: 8,
    },
  });

  type Settings = Awaited<ReturnType<typeof settings.get>>;
  let current: Settings = await settings.get();
  settings.onChange((next) => {
    current = next;
    void bb.experimental_hooks.recheck("message.dispatch");
  });

  const store = new AutopilotStore(bb.storage.kv);
  await store.load();
  const tasks = new TasksClient(bb);

  function policy(): BudgetPolicy {
    return {
      ...DEFAULT_POLICY,
      fiveHourPercent: clamp(current.fiveHourPercent, 1, 100),
      weeklyPercent: clamp(current.weeklyPercent, 1, 100),
    };
  }

  // ---------------------------------------------------------------- usage

  const usageCache = new Map<string, { at: number; usage: ProviderUsageLike | null }>();

  async function readUsage(
    providerId: string,
    hostId: string | null,
  ): Promise<ProviderUsageLike | null> {
    const key = `${hostId ?? "*"}:${providerId}`;
    const cached = usageCache.get(key);
    if (cached !== undefined && Date.now() - cached.at < USAGE_CACHE_MS) {
      return cached.usage;
    }
    let usage: ProviderUsageLike | null = null;
    try {
      const result = (await bb.sdk.system.usageLimits({
        providerId,
        ...(hostId === null ? {} : { hostId }),
      })) as Record<string, ProviderUsageLike | undefined>;
      usage = result[providerId] ?? null;
    } catch (error) {
      bb.log.warn(`usage read failed for ${providerId}: ${errorText(error)}`);
    }
    usageCache.set(key, { at: Date.now(), usage });
    return usage;
  }

  async function budgetFor(
    providerId: string,
    model: string | null,
    hostId: string | null = null,
    marginPercent = 0,
  ): Promise<BudgetVerdict> {
    return evaluateBudget({
      usage: await readUsage(providerId, hostId),
      policy: policy(),
      now: Date.now(),
      model,
      marginPercent,
      random: Math.random(),
    });
  }

  // --------------------------------------------------- the dispatch gate
  // Every message bound for an autopilot thread passes here. Over budget, the
  // message is queued with sendAt = window reset: core re-attempts it then,
  // which is what brings parked threads back to life without our own timer.
  // Threads autopilot did not start are never touched.

  bb.experimental_hooks.on("message.dispatch", async (context) => {
    if (context.attempt === "join-turn") return { action: "proceed" };
    const tracked = store.byThread(context.thread.id);
    if (tracked === null) return { action: "proceed" };
    if (store.paused) {
      return { action: "wait", reason: "Автопилот на паузе (bb autopilot resume)", sendAt: null };
    }
    const verdict = await budgetFor(
      context.thread.providerId,
      context.requestedExecution.model,
      context.host?.id ?? null,
    );
    if (verdict.kind === "ok") return { action: "proceed" };
    await store.log({ kind: "deferred", taskKey: tracked.taskKey, detail: verdict.reason });
    return { action: "wait", reason: verdict.reason, sendAt: verdict.resumeAt };
  });

  // ------------------------------------------------------------ the loop

  let ticking: Promise<string[]> | null = null;

  function tick(reason: string): Promise<string[]> {
    if (ticking !== null) return ticking;
    ticking = runTick(reason)
      .catch((error: unknown) => {
        bb.log.error(`tick failed: ${errorText(error)}`);
        return [`tick failed: ${errorText(error)}`];
      })
      .finally(() => {
        ticking = null;
      });
    return ticking;
  }

  async function runTick(reason: string): Promise<string[]> {
    const notes: string[] = [];
    if (!current.enabled) return ["autopilot disabled"];
    const presets = await tasks.listPresets();
    const worker = findPreset(presets, current.workerPreset);
    const verifier = findPreset(presets, current.verifierPreset) ?? worker;
    if (worker === null) {
      return [`worker preset "${current.workerPreset}" missing: run bb autopilot setup`];
    }

    // 1. Drive what we already own.
    for (const tracked of [...store.tracked]) {
      try {
        notes.push(...(await advance(tracked, worker, verifier!)));
      } catch (error) {
        notes.push(`${tracked.taskKey}: ${errorText(error)}`);
      }
    }

    // 2. Park running autopilot turns that blew far past the budget.
    notes.push(...(await parkOverspenders()));

    // 3. Start new work while there is room and budget.
    if (store.paused) return [...notes, "paused"];
    const free = clamp(current.maxParallel, 0, 8) - store.tracked.length;
    if (free <= 0) return notes;
    const verdict = await budgetFor(worker.providerId, worker.modelId);
    if (verdict.kind === "blocked") {
      notes.push(verdict.reason);
      return notes;
    }
    const queue = await loadQueue();
    const picked = pickNext({
      tasks: queue,
      trackedTaskIds: new Set(store.tracked.map((t) => t.taskId)),
      skipTaskIds: new Set(store.skipped),
      limit: free,
    });
    for (const task of picked) {
      notes.push(await start(task, worker));
    }
    if (picked.length === 0 && store.tracked.length === 0) {
      notes.push(...(await maybePlan()));
    }
    bb.log.info(`tick (${reason}): ${notes.join(" | ") || "nothing to do"}`);
    return notes;
  }

  async function loadQueue(): Promise<TaskRecord[]> {
    const out: TaskRecord[] = [];
    for (const project of await tasks.listProjects()) {
      const label = (await tasks.listLabels(project.id)).find(
        (l) => l.name.toLowerCase() === current.label.toLowerCase(),
      );
      if (label === undefined) continue;
      out.push(
        ...(await tasks.listTasks({
          projectId: project.id,
          statuses: ["todo"],
          labelIds: [label.id],
        })),
      );
    }
    return out;
  }

  async function start(task: TaskRecord, worker: TaskPreset): Promise<string> {
    const planner = isPlannerDescription(task.description);
    const extra = planner
      ? plannerInstructions(current.plannerSources, clamp(current.plannerMaxTasks, 1, 30))
      : workerInstructions(task.key, 0);
    const threadId = await tasks.delegate({
      taskId: task.id,
      presetId: worker.id,
      extraInstructions: extra,
    });
    const now = Date.now();
    await store.track({
      taskId: task.id,
      taskKey: task.key,
      projectId: task.projectId,
      kind: planner ? "planner" : "code",
      phase: "work",
      threadId,
      attempts: 0,
      startedAt: now,
      phaseStartedAt: now,
      lastNudgeAt: null,
      parkedAt: null,
    });
    await markThread(threadId, task.key, "work");
    await store.log({ kind: "started", taskKey: task.key, detail: threadId });
    return `${task.key}: started (${threadId})`;
  }

  async function advance(
    tracked: Tracked,
    worker: TaskPreset,
    verifier: TaskPreset,
  ): Promise<string[]> {
    const task = await tasks.getTask(tracked.taskId);
    const thread = await readThread(tracked.threadId);
    const action: LifecycleAction = decide(
      tracked,
      task === null ? null : { status: task.status },
      thread,
      {
        now: Date.now(),
        maxAttempts: clamp(current.maxAttempts, 1, 10),
        staleMs: STALE_MS,
      },
    );
    const key = tracked.taskKey;
    switch (action.kind) {
      case "none":
        return [];
      case "verify": {
        const threadId = await tasks.delegate({
          taskId: tracked.taskId,
          presetId: verifier.id,
          extraInstructions: verifierInstructions(key),
        });
        await store.update(tracked.taskId, {
          phase: "verify",
          threadId,
          phaseStartedAt: Date.now(),
          lastNudgeAt: null,
          parkedAt: null,
        });
        await markThread(threadId, key, "verify");
        await store.log({ kind: "verifying", taskKey: key, detail: threadId });
        return [`${key}: verifying`];
      }
      case "complete":
        if (tracked.kind === "planner") {
          // The planner leaves its own task in review; close it so the board stays clean.
          await tasks.updateStatus(tracked.taskId, "done").catch(() => undefined);
        }
        await store.untrack(tracked.taskId);
        await store.log({ kind: "done", taskKey: key, detail: tracked.kind });
        return [`${key}: done`];
      case "retry": {
        await tasks.comment(
          tracked.taskId,
          `🤖 Автопилот: ${action.reason}. Отправляю на попытку ${tracked.attempts + 2}.`,
        );
        const threadId = await tasks.delegate({
          taskId: tracked.taskId,
          presetId: worker.id,
          extraInstructions:
            tracked.kind === "planner"
              ? plannerInstructions(current.plannerSources, clamp(current.plannerMaxTasks, 1, 30))
              : workerInstructions(key, tracked.attempts + 1),
        });
        await store.update(tracked.taskId, {
          phase: "work",
          threadId,
          attempts: tracked.attempts + 1,
          phaseStartedAt: Date.now(),
          lastNudgeAt: null,
          parkedAt: null,
        });
        await markThread(threadId, key, "work");
        await store.log({ kind: "retry", taskKey: key, detail: action.reason });
        return [`${key}: retry — ${action.reason}`];
      }
      case "give-up":
        await tasks.comment(
          tracked.taskId,
          `🤖 Автопилот сдаётся: ${action.reason}. Возвращаю в backlog — посмотри комментарии выше и поправь задачу (Acceptance, Scope), потом верни в todo.`,
        );
        await tasks.updateStatus(tracked.taskId, "backlog");
        // No skip-list entry: backlog already keeps it out of the queue, and
        // moving it back to todo is how you say "try again".
        await store.untrack(tracked.taskId);
        await store.log({ kind: "gave-up", taskKey: key, detail: action.reason });
        return [`${key}: gave up — ${action.reason}`];
      case "release":
        await store.untrack(tracked.taskId);
        await store.log({ kind: "released", taskKey: key, detail: action.reason });
        return [`${key}: released — ${action.reason}`];
      case "nudge":
        await bb.sdk.threads.send({
          threadId: tracked.threadId,
          mode: "queue-if-active",
          input: [{ type: "text", text: nudgePrompt(key), mentions: [] }],
        } as never);
        await store.update(tracked.taskId, { lastNudgeAt: Date.now() });
        return [`${key}: nudged`];
    }
  }

  async function parkOverspenders(): Promise<string[]> {
    const notes: string[] = [];
    const margin = clamp(current.hardStopMarginPercent, 0, 40);
    for (const tracked of store.tracked) {
      const thread = await readThreadFull(tracked.threadId);
      if (thread === null || (thread.status !== "active" && thread.status !== "starting")) {
        continue;
      }
      const verdict = await budgetFor(thread.providerId, null, null, margin);
      if (verdict.kind === "ok") continue;
      // Stop the turn, then queue a continue: the dispatch gate holds it
      // until the window resets and core sends it then.
      await bb.sdk.threads.stop({ threadId: tracked.threadId });
      await bb.sdk.threads.send({
        threadId: tracked.threadId,
        mode: "queue-if-active",
        input: [{ type: "text", text: continuePrompt(), mentions: [] }],
      } as never);
      await store.update(tracked.taskId, { parkedAt: Date.now() });
      await store.log({ kind: "parked", taskKey: tracked.taskKey, detail: verdict.reason });
      notes.push(`${tracked.taskKey}: parked — ${verdict.reason}`);
    }
    return notes;
  }

  async function plannerProject() {
    const projects = await tasks.listProjects();
    const prefix = current.plannerProject.trim().toUpperCase();
    if (prefix !== "") return projects.find((p) => p.prefix === prefix) ?? null;
    // Default: the tracker project of the first roadmap source.
    const first = sourceRepos(current.plannerSources)[0];
    return first === undefined
      ? null
      : (projects.find((p) => p.name.toLowerCase() === first.toLowerCase()) ?? null);
  }

  async function maybePlan(): Promise<string[]> {
    if (Date.now() - store.lastPlannerAt < PLANNER_COOLDOWN_MS) return [];
    const project = await plannerProject();
    if (project === null) return ["planner: no tracker project (run bb autopilot setup)"];
    const prefix = project.prefix;
    const labels = await tasks.listLabels(project.id);
    const label =
      labels.find((l) => l.name.toLowerCase() === current.label.toLowerCase()) ??
      (await tasks.createLabel(project.id, current.label, "#2A9D90"));
    await tasks.createTask({
      projectId: project.id,
      title: PLANNER_TASK_TITLE,
      description: plannerTaskDescription(current.plannerSources),
      labelIds: [label.id],
      priority: "high",
    });
    await store.setLastPlannerAt(Date.now());
    await store.log({ kind: "planned", taskKey: prefix, detail: "planner task created" });
    return [`queue empty: planner task created in ${prefix}`];
  }

  // ------------------------------------------------------------- helpers

  async function readThreadFull(threadId: string) {
    try {
      return (await bb.sdk.threads.get({ threadId })) as {
        status: string;
        providerId: string;
        queuedMessageCount: number;
      };
    } catch {
      return null;
    }
  }

  async function readThread(threadId: string) {
    const thread = await readThreadFull(threadId);
    return thread === null
      ? null
      : { status: thread.status, queuedMessageCount: thread.queuedMessageCount ?? 0 };
  }

  async function markThread(threadId: string, taskKey: string, phase: string) {
    try {
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        set: { autopilot: true, taskKey, phase },
      });
    } catch (error) {
      bb.log.debug(`could not tag ${threadId}: ${errorText(error)}`);
    }
  }

  async function setup(input: { provider?: string; model?: string }): Promise<string[]> {
    const notes: string[] = [];
    const presets = await tasks.listPresets();
    const base = presets[0] ?? null;
    const providerId = input.provider ?? base?.providerId;
    const modelId = input.model ?? base?.modelId;
    if (providerId === undefined || modelId === undefined) {
      throw new Error(
        "No preset to copy provider/model from: pass --provider and --model (see `bb tasks preset list`).",
      );
    }
    for (const [name, reasoningLevel] of [
      [current.workerPreset, "high"],
      [current.verifierPreset, "medium"],
    ] as const) {
      if (findPreset(presets, name) !== null) {
        notes.push(`preset "${name}" exists`);
        continue;
      }
      await tasks.createPreset({
        name,
        providerId,
        modelId,
        reasoningLevel,
        permissionMode: "full",
        environmentKind: "new-worktree",
        instructions:
          "Autopilot thread: follow the autopilot contract in the task message exactly. Comments to the human in Russian.",
      });
      notes.push(`preset "${name}" created (${providerId} / ${modelId})`);
    }
    // Tracker projects for the roadmap repos, linked to the bb projects of
    // the same name, so delegated workers run inside the right repo.
    const bbProjects = (await bb.sdk.projects.list()) as { id: string; name: string }[];
    let trackers = await tasks.listProjects();
    for (const repo of sourceRepos(current.plannerSources)) {
      const bbProject = bbProjects.find((p) => p.name.toLowerCase() === repo.toLowerCase());
      if (bbProject === undefined) {
        notes.push(`bb project "${repo}" not found — add the repo to bb, then rerun setup`);
        continue;
      }
      if (trackers.some((p) => p.linkedBbProjectId === bbProject.id)) continue;
      const created = await tasks.createProject({
        name: bbProject.name,
        prefix: prefixFor(repo, trackers.map((p) => p.prefix)),
        color: "#6F63D6",
        linkedBbProjectId: bbProject.id,
      });
      trackers = [...trackers, created];
      notes.push(`tracker project ${created.prefix} created for ${bbProject.name}`);
    }
    for (const project of trackers) {
      const labels = await tasks.listLabels(project.id);
      if (labels.some((l) => l.name.toLowerCase() === current.label.toLowerCase())) continue;
      await tasks.createLabel(project.id, current.label, "#2A9D90");
      notes.push(`label "${current.label}" added to ${project.prefix}`);
    }
    // Fill the queue right away instead of waiting for the next tick.
    await store.setLastPlannerAt(0);
    notes.push(...(await tick("setup")));
    return notes;
  }

  async function recheck(): Promise<void> {
    await bb.experimental_hooks.recheck("message.dispatch");
  }

  // ------------------------------------------------------------ triggers

  bb.background.schedule("tick", "*/5 * * * *", async () => {
    await tick("schedule");
  });

  // React quickly when an autopilot thread settles, instead of waiting for
  // the next five-minute tick.
  bb.events.on("thread.idle", async (event) => {
    if (store.byThread(event.thread.id) !== null) await tick("thread idle");
  });
  bb.events.on("thread.failed", async (event) => {
    if (store.byThread(event.thread.id) !== null) await tick("thread failed");
  });

  const runtime: AutopilotRuntime = {
    store,
    tick,
    budgetFor: (providerId, model) => budgetFor(providerId, model),
    setup,
    recheck,
  };
  registerAutopilotCli(bb, runtime);
}

function findPreset(presets: TaskPreset[], name: string): TaskPreset | null {
  const wanted = name.trim().toLowerCase();
  return presets.find((preset) => preset.name.trim().toLowerCase() === wanted) ?? null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { AutopilotEvent };
