import type {
  PendingInteraction,
  PendingInteractionResolution,
} from "@bb/domain";
import type { BbSdk } from "@bb/sdk";
import type { HookEvent, HookResponse, NotchClient } from "./notch-client.js";

export type ThreadSnapshot = {
  id: string;
  title: string | null;
  status: string;
  attention: boolean;
};

type NotchStatus = "working" | "idle";

export interface BridgeLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface BridgeOptions {
  sdk: BbSdk;
  notch: NotchClient;
  log: BridgeLogger;
  // How long the notch may hold a question before we give up and let bb's
  // own UI take it. NotchAgent drops stale connections after ~130 s.
  decisionTimeoutMs?: number;
  pollIntervalMs?: number;
}

const BUSY_STATUSES = new Set(["active", "starting", "queued"]);

export class NotchBridge {
  private readonly sdk: BbSdk;
  private readonly notch: NotchClient;
  private readonly log: BridgeLogger;
  private readonly decisionTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private threads = new Map<string, ThreadSnapshot>();
  private inFlight = new Set<string>();
  private forwarded = new Map<string, string>(); // interaction id → thread id
  private lastStatus: NotchStatus | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;
  private refreshQueued = false;
  private unsubscribe: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: BridgeOptions) {
    this.sdk = options.sdk;
    this.notch = options.notch;
    this.log = options.log;
    this.decisionTimeoutMs = options.decisionTimeoutMs ?? 120_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 5_000;
  }

  async start(): Promise<void> {
    await this.refresh({ initial: true });
    this.unsubscribe = this.sdk.subscribe({
      event: "thread:changed",
      callback: () => this.scheduleRefresh(),
    });
    this.pollTimer = setInterval(
      () => this.scheduleRefresh(),
      this.pollIntervalMs,
    );
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh({ initial: false });
    }, 250);
  }

  private async refresh(args: { initial: boolean }): Promise<void> {
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    try {
      const list = await this.sdk.threads.list();
      const next = new Map<string, ThreadSnapshot>();
      for (const thread of list) {
        if (thread.archivedAt || thread.deletedAt) continue;
        next.set(thread.id, {
          id: thread.id,
          title: thread.title ?? null,
          status: thread.runtime?.displayStatus ?? "idle",
          attention:
            thread.latestAttentionAt !== null &&
            thread.latestAttentionAt !== undefined,
        });
      }
      if (!args.initial) await this.announceFinishedTurns(next);
      this.threads = next;
      // Notch outages must not stop interaction forwarding, and vice versa.
      await this.pushStatus().catch((error) =>
        this.log.warn(`status push failed: ${String(error)}`),
      );
      await this.forwardPendingInteractions();
    } catch (error) {
      this.log.warn(
        `refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.refreshing = false;
      if (this.refreshQueued) {
        this.refreshQueued = false;
        this.scheduleRefresh();
      }
    }
  }

  // A thread that just went busy → idle finished a turn: surface its answer
  // the way the Claude Code Stop hook did, so the notch can show a summary or
  // flip to "needs attention" when the answer ends in a question.
  private async announceFinishedTurns(
    next: Map<string, ThreadSnapshot>,
  ): Promise<void> {
    for (const [id, before] of this.threads) {
      const after = next.get(id);
      if (
        !after ||
        !BUSY_STATUSES.has(before.status) ||
        BUSY_STATUSES.has(after.status)
      )
        continue;
      try {
        const output = await this.sdk.threads.output({ threadId: id });
        const text = (output.output ?? "").trim();
        await this.notch.send({
          id: `stop-${id}-${Date.now()}`,
          type: "Stop",
          session_id: id,
          stop_reason: after.status === "error" ? "error" : "end_turn",
          message: text.length > 800 ? text.slice(-800) : text,
        });
        this.log.info(`turn finished: ${after.title ?? id}`);
      } catch (error) {
        this.log.warn(
          `announce failed for ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async pushStatus(): Promise<void> {
    const busy = [...this.threads.values()].some((thread) =>
      BUSY_STATUSES.has(thread.status),
    );
    const status: NotchStatus = busy ? "working" : "idle";
    if (status === this.lastStatus) return;
    // Mark as delivered only after the write succeeded: when NotchAgent is
    // not up yet, the next refresh must try again instead of going quiet.
    await this.notch.send({
      id: `status-${Date.now()}`,
      type: "Status",
      message: status,
    });
    this.lastStatus = status;
  }

  private async forwardPendingInteractions(): Promise<void> {
    const candidates = [...this.threads.values()].filter(
      (thread) => thread.attention || BUSY_STATUSES.has(thread.status),
    );
    const stillPending = new Set<string>();
    for (const thread of candidates) {
      let interactions: PendingInteraction[];
      try {
        interactions = await this.sdk.threads.interactions.list({
          threadId: thread.id,
        });
      } catch {
        continue;
      }
      for (const interaction of interactions) {
        if (interaction.status === "pending") stillPending.add(interaction.id);
        if (
          interaction.status !== "pending" ||
          this.inFlight.has(interaction.id)
        )
          continue;
        const event = toHookEvent(interaction, thread);
        if (!event) continue;
        this.inFlight.add(interaction.id);
        this.forwarded.set(interaction.id, thread.id);
        void this.askAndResolve(interaction, event, thread);
      }
    }
    // Resolved in bb's own UI, CLI, or by timeout: the notch must not keep
    // showing a decision nobody can deliver any more.
    for (const [id, threadId] of this.forwarded) {
      if (stillPending.has(id)) continue;
      this.forwarded.delete(id);
      try {
        await this.notch.send({ id, type: "Cancel", session_id: threadId });
      } catch {
        // NotchAgent not running: nothing to cancel.
      }
    }
  }

  private async askAndResolve(
    interaction: PendingInteraction,
    event: HookEvent,
    thread: ThreadSnapshot,
  ): Promise<void> {
    try {
      this.log.info(
        `asking notch: ${event.tool_name} for ${thread.title ?? thread.id}`,
      );
      const response = await this.notch.ask(event, this.decisionTimeoutMs);
      if (!response) {
        this.log.info(
          `notch gave no decision for ${interaction.id}; leaving it to bb UI`,
        );
        return;
      }
      const resolution = toResolution(interaction, response);
      if (!resolution) {
        this.log.warn(
          `could not map notch answer ${JSON.stringify(response)} for ${interaction.id}`,
        );
        return;
      }
      await this.sdk.threads.interactions.resolve({
        threadId: thread.id,
        interactionId: interaction.id,
        resolution,
      });
      this.log.info(
        `resolved ${interaction.id}: ${response.action}${response.message ? ` (${response.message})` : ""}`,
      );
    } catch (error) {
      this.log.warn(
        `resolve failed for ${interaction.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      // Let the id be forwarded again only if bb still reports it pending on a
      // later refresh — e.g. the notch timed out but the human never answered.
      setTimeout(() => this.inFlight.delete(interaction.id), 2_000);
    }
  }
}

export function toHookEvent(
  interaction: PendingInteraction,
  thread: ThreadSnapshot,
): HookEvent | null {
  const payload = interaction.payload;
  const base = { id: interaction.id, session_id: thread.id };
  switch (payload.kind) {
    case "approval": {
      const subject = payload.subject;
      switch (subject.kind) {
        case "command":
          return {
            ...base,
            type: "PermissionRequest",
            tool_name: "Bash",
            tool_input: subject.command,
            message: payload.reason ?? undefined,
          };
        case "file_change":
          return {
            ...base,
            type: "PermissionRequest",
            tool_name: "Edit",
            tool_input: subject.writeScope ?? "workspace",
            message: payload.reason ?? undefined,
          };
        case "permission_grant":
          return {
            ...base,
            type: "PermissionRequest",
            tool_name: subject.toolName ?? "Permission",
            tool_input: describePermissions(subject.permissions),
            message: payload.reason ?? undefined,
          };
        case "plan":
          return {
            ...base,
            type: "PermissionRequest",
            tool_name: "Plan",
            tool_input: subject.plan.slice(0, 300),
            message: payload.reason ?? undefined,
          };
        default:
          return null;
      }
    }
    case "user_question": {
      const question = payload.questions[0];
      if (!question) return null;
      const choices = (question.options ?? []).map((option) => option.label);
      if (choices.length === 0) return null;
      return {
        ...base,
        type: "PermissionRequest",
        tool_name: "AskUserQuestion",
        message:
          payload.questions.length > 1
            ? `${question.prompt} (1/${payload.questions.length})`
            : question.prompt,
        choices,
      };
    }
    default:
      return null;
  }
}

export function toResolution(
  interaction: PendingInteraction,
  response: HookResponse,
): PendingInteractionResolution | null {
  const payload = interaction.payload;
  if (payload.kind === "approval") {
    if (response.action === "deny") return { decision: "deny" };
    const forSession =
      response.action === "always_allow" &&
      payload.availableDecisions.includes("allow_for_session");
    return {
      decision: forSession ? "allow_for_session" : "allow_once",
      grantedPermissions: null,
    };
  }
  if (payload.kind === "user_question") {
    if (response.action === "deny") return null;
    const question = payload.questions[0];
    if (!question) return null;
    const chosen = (question.options ?? []).find(
      (option) => option.label === response.message,
    );
    if (chosen) {
      return {
        kind: "user_answer",
        answers: { [question.id]: { selected: [chosen.value] } },
      };
    }
    if (question.allowFreeText && response.message) {
      return {
        kind: "user_answer",
        answers: {
          [question.id]: { selected: [], freeText: response.message },
        },
      };
    }
    return null;
  }
  return null;
}

function describePermissions(permissions: unknown): string {
  try {
    return JSON.stringify(permissions).slice(0, 300);
  } catch {
    return "permissions";
  }
}
