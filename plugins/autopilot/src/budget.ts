export interface UsageWindowLike {
  label: string;
  usedPercent: number;
  resetsAt: string | null;
  kind?: string;
  model?: string;
}

export interface ProviderUsageLike {
  status: string;
  windows?: readonly UsageWindowLike[];
  message?: string;
}

export interface BudgetPolicy {
  fiveHourPercent: number;
  weeklyPercent: number;
  unknownBackoffMs: number;
  jitterMinMs: number;
  jitterMaxMs: number;
}

export const DEFAULT_POLICY: BudgetPolicy = {
  fiveHourPercent: 60,
  weeklyPercent: 70,
  unknownBackoffMs: 15 * 60_000,
  jitterMinMs: 60_000,
  jitterMaxMs: 6 * 60_000,
};

export type WindowClass = "five-hour" | "weekly" | "other";

export interface ExceededWindow {
  label: string;
  windowClass: Exclude<WindowClass, "other">;
  usedPercent: number;
  limitPercent: number;
  resetsAtMs: number | null;
}

export type BudgetVerdict =
  | { kind: "ok"; headroomPercent: number }
  | {
      kind: "blocked";
      reason: string;
      resumeAt: number;
      exceeded: ExceededWindow[];
    };

export function classifyWindow(window: UsageWindowLike): WindowClass {
  if (window.kind === "five-hour" || window.kind === "weekly") {
    return window.kind;
  }
  const label = window.label.toLowerCase();
  if (/(5\s*h|five|session|5-hour|hourly)/u.test(label)) return "five-hour";
  if (/(week|7\s*d|seven)/u.test(label)) return "weekly";
  return "other";
}

function parseResetMs(resetsAt: string | null): number | null {
  if (resetsAt === null) return null;
  const ms = Date.parse(resetsAt);
  return Number.isNaN(ms) ? null : ms;
}

function windowApplies(window: UsageWindowLike, model: string | null): boolean {
  if (window.model === undefined || window.model === "") return true;
  if (model === null) return false;
  return model.toLowerCase().includes(window.model.toLowerCase());
}

function formatClock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16) + " UTC";
}

export interface EvaluateBudgetInput {
  usage: ProviderUsageLike | null | undefined;
  policy: BudgetPolicy;
  now: number;
  model?: string | null;
  marginPercent?: number;
  random?: number;
}

export function evaluateBudget(input: EvaluateBudgetInput): BudgetVerdict {
  const { usage, policy, now } = input;
  const margin = input.marginPercent ?? 0;
  const random = input.random ?? 0.5;
  const jitter =
    policy.jitterMinMs +
    Math.max(0, Math.min(1, random)) * (policy.jitterMaxMs - policy.jitterMinMs);

  if (usage === null || usage === undefined || usage.status !== "ok") {
    const status = usage?.status ?? "missing";
    return {
      kind: "blocked",
      reason: `Не удалось прочитать лимиты провайдера (${status}); пробую снова позже`,
      resumeAt: now + policy.unknownBackoffMs,
      exceeded: [],
    };
  }

  const exceeded: ExceededWindow[] = [];
  let headroom = 100;
  for (const window of usage.windows ?? []) {
    const windowClass = classifyWindow(window);
    if (windowClass === "other") continue;
    if (!windowApplies(window, input.model ?? null)) continue;
    const limitPercent = Math.min(
      100,
      (windowClass === "five-hour"
        ? policy.fiveHourPercent
        : policy.weeklyPercent) + margin,
    );
    headroom = Math.min(headroom, limitPercent - window.usedPercent);
    if (window.usedPercent >= limitPercent) {
      exceeded.push({
        label: window.label,
        windowClass,
        usedPercent: window.usedPercent,
        limitPercent,
        resetsAtMs: parseResetMs(window.resetsAt),
      });
    }
  }

  if (exceeded.length === 0) {
    return { kind: "ok", headroomPercent: Math.max(0, headroom) };
  }

  let resumeAt = now + policy.unknownBackoffMs;
  const known = exceeded
    .map((window) => window.resetsAtMs)
    .filter((ms): ms is number => ms !== null);
  if (known.length === exceeded.length) {
    resumeAt = Math.max(now, ...known);
  } else if (known.length > 0) {
    resumeAt = Math.max(resumeAt, ...known);
  }
  resumeAt = Math.round(resumeAt + jitter);

  const reason =
    "Автопилот ждёт лимиты: " +
    exceeded
      .map(
        (window) =>
          `${window.label} ${Math.round(window.usedPercent)}% ≥ ${window.limitPercent}%`,
      )
      .join(", ") +
    `; продолжу после ${formatClock(resumeAt)}`;

  return { kind: "blocked", reason, resumeAt, exceeded };
}
