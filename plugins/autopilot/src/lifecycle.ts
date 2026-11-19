export type Phase = "work" | "verify";
export type TrackedKind = "code" | "planner";

export interface Tracked {
  taskId: string;
  taskKey: string;
  projectId: string;
  kind: TrackedKind;
  phase: Phase;
  threadId: string;
  threadIds?: string[];
  attempts: number;
  startedAt: number;
  phaseStartedAt: number;
  lastNudgeAt: number | null;
  parkedAt: number | null;
}

export interface TaskObservation {
  status: string;
}

export interface ThreadObservation {
  status: string;
  queuedMessageCount: number;
}

export type LifecycleAction =
  | { kind: "none" }
  | { kind: "verify" }
  | { kind: "complete" }
  | { kind: "retry"; reason: string }
  | { kind: "give-up"; reason: string }
  | { kind: "release"; reason: string }
  | { kind: "nudge" };

export interface DecideOptions {
  now: number;
  maxAttempts: number;
  staleMs: number;
}

function retryOrGiveUp(
  tracked: Tracked,
  reason: string,
  options: DecideOptions,
): LifecycleAction {
  if (tracked.attempts + 1 >= options.maxAttempts) {
    return {
      kind: "give-up",
      reason: `${reason}; попыток: ${tracked.attempts + 1} из ${options.maxAttempts}`,
    };
  }
  return { kind: "retry", reason };
}

function stalled(
  tracked: Tracked,
  thread: ThreadObservation | null,
  options: DecideOptions,
): boolean {
  if (thread === null) return false;
  if (thread.status !== "idle") return false;
  if (thread.queuedMessageCount > 0) return false;
  const since = Math.max(tracked.phaseStartedAt, tracked.lastNudgeAt ?? 0);
  return options.now - since >= options.staleMs;
}

export function decide(
  tracked: Tracked,
  task: TaskObservation | null,
  thread: ThreadObservation | null,
  options: DecideOptions,
): LifecycleAction {
  if (task === null) return { kind: "release", reason: "задача удалена" };

  switch (task.status) {
    case "canceled":
      return { kind: "release", reason: "задача отменена" };
    case "backlog":
      return { kind: "release", reason: "задачу вернули в backlog" };
    case "done":
      if (tracked.kind === "code" && tracked.phase === "work") {
        return { kind: "verify" };
      }
      return { kind: "complete" };
    default:
      break;
  }

  if (tracked.phase === "work") {
    if (task.status === "in_review") {
      return tracked.kind === "planner" ? { kind: "complete" } : { kind: "verify" };
    }
    if (task.status === "todo") {
      return retryOrGiveUp(tracked, "исполнитель вернул задачу", options);
    }
  } else {
    if (task.status === "todo") {
      return retryOrGiveUp(tracked, "проверка не прошла", options);
    }
  }

  if (thread === null) {
    return retryOrGiveUp(tracked, "поток исчез", options);
  }
  if (thread.status === "error" && thread.queuedMessageCount === 0) {
    return retryOrGiveUp(tracked, "поток упал с ошибкой", options);
  }
  if (stalled(tracked, thread, options)) return { kind: "nudge" };
  return { kind: "none" };
}
