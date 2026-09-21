import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  AGENT_MODEL_MAX_LENGTH,
  AGENT_ROLES,
  agentEffortSchema,
  agentModelValueSchema,
  workbenchHostContract,
  type AgentRole,
} from "./contract.js";
import { projectSpecCandidates } from "./project-specs.js";
import {
  WORKBENCH_MULTI_MODEL_MODE_REALTIME_CHANNEL,
  WORKBENCH_SUBAGENTS_REALTIME_CHANNEL,
} from "./realtime-channel.js";
import {
  REVIEW_TARGET_SOURCES,
  THREAD_DEPENDENT_REVIEW_MESSAGE,
  resolveReviewTarget,
  resolveRoutedReviewTarget,
  type ReviewTargetRequest,
  type ReviewTargetResolution,
} from "./review-target.js";
import {
  ROUTING_ROLES,
  disallowedModelMessage,
  isModelAllowedForRole,
  parseRoutingTable,
  routingDrift,
  routingEntryFor,
  routingEntryForAgent,
  type RoutingEntry,
} from "./routing.js";
import {
  extractCreatedFilePaths,
  flattenFileChangeRows,
  isAbsoluteOutputPath,
  subagentRow,
  type TimelineFileChangeEntry,
} from "./subagents-data.js";

const MULTI_MODEL_INSTRUCTIONS =
  "Multi-model mode: orchestrate as the architect — delegate " +
  "reconnaissance to the `scout` subagent, implementation of each task to " +
  "`implementer`, and in-thread verification to `reviewer`, one subagent " +
  "per task with the full context in its prompt. Before reporting " +
  "completion, run `bb workbench review <this thread id>` (the thread id is " +
  "available via `bb status`) for the cross-vendor review and address its " +
  "findings.";

const REVIEW_PROVIDER_AUTO = "auto";

const SPEC_PROJECT_FILE = ".claude/specs/PROJECT.md";

const REVIEW_THREAD_IDS_KV_KEY = "reviewThreadIds";

const INVALID_MODEL_MESSAGE =
  "Invalid model: expected a single token (letters, digits, " +
  `._:/[]-), up to ${AGENT_MODEL_MAX_LENGTH} characters`;

const PERMISSION_MODE_RANK = ["accept-edits", "auto", "full"] as const;
type WorkbenchPermissionMode = (typeof PERMISSION_MODE_RANK)[number];

function lowestSupportedPermissionMode(
  permissionModes: readonly string[],
): WorkbenchPermissionMode {
  const match = PERMISSION_MODE_RANK.find((mode) =>
    permissionModes.includes(mode),
  );
  return match ?? (permissionModes[0] as WorkbenchPermissionMode);
}

function appliedReasoningLevel<L extends string>(
  effort: string | null,
  supported: readonly { reasoningEffort: L }[],
): L | null {
  if (effort === null) return null;
  return (
    supported.find((entry) => entry.reasoningEffort === effort)
      ?.reasoningEffort ?? null
  );
}

const AGENT_DISPLAY_ORDER: readonly AgentRole[] = [
  "implementer",
  "scout",
  "reviewer",
];

function describeRoutingEntry(entry: RoutingEntry): string {
  const subagent =
    entry.subagentModel === null ? "" : ` (subagent: ${entry.subagentModel})`;
  const effort = entry.effort === null ? "" : ` · ${entry.effort}`;
  return `${entry.providerId} / ${entry.model}${subagent}${effort}`;
}

function parseReviewArgs(
  args: readonly string[],
): { threadId: string; providerId: string | undefined } | null {
  let threadId: string | undefined;
  let providerId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--provider") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      providerId = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--") || threadId !== undefined) return null;
    threadId = arg;
  }
  return threadId === undefined ? null : { threadId, providerId };
}

const reviewErrorSchema = z.enum([
  "host_unavailable",
  "no_provider_available",
  "provider_unavailable",
  "no_environment",
  "review_of_review",
]);
type ReviewError = z.infer<typeof reviewErrorSchema>;

const reviewTargetSchema = z
  .object({
    providerId: z.string(),
    providerName: z.string(),
    model: z.string(),
    effort: z.string().nullable(),
    reasoningLevel: z.string().nullable(),
    source: z.enum(REVIEW_TARGET_SOURCES),
  })
  .strict();
type ReviewTarget = z.infer<typeof reviewTargetSchema>;

const reviewTargetResultSchema = z.discriminatedUnion("ok", [
  reviewTargetSchema.extend({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), error: reviewErrorSchema }).strict(),
]);

const hostReviewTargetResultSchema = z.discriminatedUnion("ok", [
  reviewTargetSchema.extend({ ok: z.literal(true) }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.enum([...reviewErrorSchema.options, "thread_dependent"]),
    })
    .strict(),
]);
type HostReviewTargetResult = z.infer<typeof hostReviewTargetResultSchema>;

const reviewPreviewSchema = z
  .object({
    target: reviewTargetResultSchema,
    options: z.array(reviewTargetSchema),
  })
  .strict();

const requestReviewResultSchema = z.discriminatedUnion("ok", [
  reviewTargetSchema
    .extend({ ok: z.literal(true), reviewThreadId: z.string() })
    .strict(),
  z.object({ ok: z.literal(false), error: reviewErrorSchema }).strict(),
]);

const routingErrorSchema = z.enum([
  "host_unavailable",
  "missing_file",
  "missing_frontmatter",
  "missing_model_key",
  "call_failed",
  "not_allowed",
]);

type RoutingError = z.infer<typeof routingErrorSchema>;
type RoutingRow =
  | { ok: true; model: string; effort: string | null }
  | { ok: false; error: RoutingError };

const routingRowSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      model: z.string(),
      effort: z.string().nullable(),
    })
    .strict(),
  z.object({ ok: z.literal(false), error: routingErrorSchema }).strict(),
]) satisfies z.ZodType<RoutingRow>;

const routingEntrySchema = z
  .object({
    role: z.enum(ROUTING_ROLES),
    providerId: z.string(),
    model: z.string(),
    subagentModel: z.string().nullable(),
    effort: z.string().nullable(),
  })
  .strict() satisfies z.ZodType<RoutingEntry>;

const routingSourceErrorSchema = z.enum([
  "host_unavailable",
  "missing_file",
  "no_table",
  "call_failed",
]);

type RoutingSource =
  | { ok: true; entries: RoutingEntry[] }
  | { ok: false; error: z.infer<typeof routingSourceErrorSchema> };

const routingSourceSchema = z.discriminatedUnion("ok", [
  z
    .object({ ok: z.literal(true), entries: z.array(routingEntrySchema) })
    .strict(),
  z.object({ ok: z.literal(false), error: routingSourceErrorSchema }).strict(),
]) satisfies z.ZodType<RoutingSource>;

const modelOptionSchema = z
  .object({ id: z.string(), displayName: z.string() })
  .strict();

const providerOptionSchema = z
  .object({ id: z.string(), name: z.string() })
  .strict();

const routingViewSchema = z
  .object({
    hostId: z.string().nullable(),
    providers: z.array(providerOptionSchema),
    providerId: z.string().nullable(),
    providerName: z.string().nullable(),
    models: z.array(modelOptionSchema),
    routing: routingSourceSchema,
    scout: routingRowSchema,
    implementer: routingRowSchema,
    reviewer: routingRowSchema,
    reviewProvider: z.string(),
    reviewTarget: hostReviewTargetResultSchema,
  })
  .strict();

const specFileSchema = z
  .object({ name: z.string(), path: z.string(), hostId: z.string() })
  .strict();

const projectSpecFileSchema = z
  .object({
    projectId: z.string(),
    projectName: z.string(),
    name: z.string(),
    path: z.string(),
    hostId: z.string(),
  })
  .strict();

const subagentRowSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["active", "done"]),
    updatedAt: z.string(),
  })
  .strict();

const threadOutputRowSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("workspace"),
      path: z.string(),
      environmentId: z.string(),
    })
    .strict(),
  z
    .object({ kind: z.literal("host"), path: z.string(), hostId: z.string() })
    .strict(),
]);
type ThreadOutputTarget = z.infer<typeof threadOutputRowSchema>;

export const workbenchRpcContract = defineRpcContract({
  runSpecCheck: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ command: z.string() }).strict(),
  },
  runBugfix: {
    input: z
      .object({ threadId: z.string().min(1), description: z.string().min(1) })
      .strict(),
    output: z.object({ command: z.string() }).strict(),
  },
  requestReview: {
    input: z
      .object({
        threadId: z.string().min(1),
        providerId: z.string().min(1).optional(),
      })
      .strict(),
    output: requestReviewResultSchema,
  },
  reviewProviderPreview: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: reviewPreviewSchema,
  },
  setReviewProviderOption: {
    input: z.object({ value: z.string().min(1) }).strict(),
    output: z.object({ value: z.string() }).strict(),
  },
  runSpecInit: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ command: z.string() }).strict(),
  },
  specInitBannerStatus: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ show: z.boolean() }).strict(),
  },
  getRouting: {
    input: z.object({ providerId: z.string().nullable() }).strict(),
    output: routingViewSchema,
  },
  setRouting: {
    input: z
      .object({
        role: z.enum(AGENT_ROLES),
        model: agentModelValueSchema,
      })
      .strict(),
    output: routingRowSchema,
  },
  setRoutingEffort: {
    input: z
      .object({ role: z.enum(AGENT_ROLES), effort: agentEffortSchema })
      .strict(),
    output: routingRowSchema,
  },
  getOrchestratedMode: {
    input: z.null(),
    output: z.object({ enabled: z.boolean() }).strict(),
  },
  setOrchestratedMode: {
    input: z.object({ enabled: z.boolean() }).strict(),
    output: z.object({ enabled: z.boolean() }).strict(),
  },
  listSpecs: {
    input: z.null(),
    output: z
      .object({
        files: z.array(specFileSchema),
        projects: z.array(projectSpecFileSchema),
      })
      .strict(),
  },
  threadSubagents: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ subagents: z.array(subagentRowSchema) }).strict(),
  },
  threadOutputs: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ outputs: z.array(threadOutputRowSchema) }).strict(),
  },
});

const SUBAGENT_LIST_LIMIT = 100;
const OUTPUTS_TIMELINE_SEGMENT_LIMIT = "100";
const OUTPUTS_TIMELINE_MAX_PAGES = 3;

function isAgentRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if (
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return undefined;
}

export default async function workbenchPlugin(bb: BbPluginApi): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: workbenchHostContract,
  });

  const settings = bb.settings.define({
    orchestratedMode: {
      type: "boolean",
      label: "Multi-model mode",
      description:
        "Ask agents to delegate reconnaissance, implementation, and review " +
        "to subagents, and to request a cross-model review before " +
        "reporting completion. Applies to new sessions.",
      default: false,
    },
    reviewProvider: {
      type: "string",
      label: "Review provider",
      description:
        '"Ask for review" provider: "auto" follows ~/.claude/ROUTING.md ' +
        "(the cross-vendor reviewer, then the in-thread reviewer, then the " +
        "first available provider that differs from the thread's own), or " +
        "an explicit provider id.",
      default: REVIEW_PROVIDER_AUTO,
    },
  });
  let orchestratedMode = (await settings.get()).orchestratedMode;
  let reviewProviderValue = (await settings.get()).reviewProvider;
  settings.onChange((next) => {
    orchestratedMode = next.orchestratedMode;
    reviewProviderValue = next.reviewProvider;
  });

  const reviewThreadIds = new Set<string>(
    (await bb.storage.kv.get<string[]>(REVIEW_THREAD_IDS_KV_KEY)) ?? [],
  );

  async function markReviewThread(threadId: string): Promise<void> {
    reviewThreadIds.add(threadId);
    await bb.storage.kv.set(REVIEW_THREAD_IDS_KV_KEY, [...reviewThreadIds]);
  }

  bb.agents.contributeInstructions((ctx) =>
    orchestratedMode && !reviewThreadIds.has(ctx.threadId)
      ? MULTI_MODEL_INSTRUCTIONS
      : null,
  );

  function publishMultiModelModeChanged(enabled: boolean): void {
    bb.realtime.publish(WORKBENCH_MULTI_MODEL_MODE_REALTIME_CHANNEL, {
      enabled,
    });
  }

  function publishSubagentsChanged(parentThreadId: string): void {
    bb.realtime.publish(WORKBENCH_SUBAGENTS_REALTIME_CHANNEL, {
      parentThreadId,
    });
  }

  for (const event of [
    "thread.created",
    "thread.active",
    "thread.idle",
    "thread.failed",
  ] as const) {
    bb.events.on(event, ({ thread }) => {
      if (thread.parentThreadId !== null) {
        publishSubagentsChanged(thread.parentThreadId);
      }
    });
  }
  bb.events.on("thread.idle", ({ thread }) => {
    if (thread.parentThreadId === null) publishSubagentsChanged(thread.id);
  });

  async function primaryHostId(): Promise<string | null> {
    const hosts = await bb.sdk.hosts.list();
    return (
      hosts.find((candidate) => candidate.status === "connected")?.id ?? null
    );
  }

  async function specCheckCommand(threadId: string): Promise<string> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId === null) return "/spec-check";
    let environment;
    try {
      environment = await bb.sdk.environments.get({
        environmentId: thread.environmentId,
      });
    } catch {
      return "/spec-check";
    }
    const base =
      environment.mergeBaseBranch ??
      environment.baseBranch ??
      environment.defaultBranch ??
      null;
    if (
      environment.isWorktree &&
      base !== null &&
      environment.branchName !== null
    ) {
      return `/spec-check ${base}..${environment.branchName}`;
    }
    return "/spec-check";
  }

  async function diffScopeForThread(
    environmentId: string | null,
  ): Promise<{ environmentId: string | null; diffCommand: string }> {
    if (environmentId === null) {
      return { environmentId: null, diffCommand: "git diff HEAD" };
    }
    let environment;
    try {
      environment = await bb.sdk.environments.get({ environmentId });
    } catch {
      return { environmentId, diffCommand: "git diff HEAD" };
    }
    const base =
      environment.mergeBaseBranch ??
      environment.baseBranch ??
      environment.defaultBranch ??
      null;
    if (
      environment.isWorktree &&
      base !== null &&
      environment.branchName !== null
    ) {
      return {
        environmentId,
        diffCommand: `git diff ${base}...${environment.branchName}`,
      };
    }
    return { environmentId, diffCommand: "git diff HEAD" };
  }

  function buildReviewPrompt(diffCommand: string): string {
    const untrackedNote =
      diffCommand === "git diff HEAD"
        ? " plus any untracked files (`git status --porcelain`)"
        : "";
    return (
      `Review the changes (\`${diffCommand}\`${untrackedNote}) in this ` +
      "workspace for correctness, security, and tests. List findings by " +
      "severity with file:line and a concrete fix. Do not modify files. " +
      "This thread is itself the cross-model review: do not run " +
      "`bb workbench review` or request another review. Finish with a " +
      "verdict."
    );
  }

  async function resolveHostIdForEnvironment(
    environmentId: string,
  ): Promise<string | null> {
    try {
      return (await bb.sdk.environments.get({ environmentId })).hostId;
    } catch {
      return null;
    }
  }

  async function readRoutingSource(
    hostId: string | null,
  ): Promise<RoutingSource> {
    if (hostId === null) return { ok: false, error: "host_unavailable" };
    let result;
    try {
      result = await host.call("readRouting", null, { hostId });
    } catch {
      return { ok: false, error: "call_failed" };
    }
    if (!result.ok) return result;
    const entries = parseRoutingTable(result.markdown);
    if (entries.length === 0) return { ok: false, error: "no_table" };
    return { ok: true, entries };
  }

  interface ReviewProviderCandidate {
    id: string;
    displayName: string;
    permissionModes: readonly string[];
  }

  async function availableReviewProviders(
    hostId: string,
  ): Promise<ReviewProviderCandidate[] | null> {
    try {
      return (await bb.sdk.providers.list({ hostId }))
        .filter((provider) => provider.available)
        .map((provider) => ({
          id: provider.id,
          displayName: provider.displayName,
          permissionModes: provider.capabilities.permissionModes,
        }));
    } catch {
      return null;
    }
  }

  function catalogLoader(hostId: string) {
    const cache = new Map<string, ReturnType<typeof bb.sdk.providers.models>>();
    return async (providerId: string) => {
      let pending = cache.get(providerId);
      if (pending === undefined) {
        pending = bb.sdk.providers.models({ hostId, providerId });
        cache.set(providerId, pending);
      }
      return (await pending).models;
    };
  }

  function reviewRequestFor(
    providerOverride: string | undefined,
  ): ReviewTargetRequest {
    if (providerOverride !== undefined) {
      return { kind: "provider", providerId: providerOverride };
    }
    return reviewProviderValue === REVIEW_PROVIDER_AUTO
      ? { kind: "auto" }
      : { kind: "provider", providerId: reviewProviderValue };
  }

  type CatalogModel = Awaited<
    ReturnType<ReturnType<typeof catalogLoader>>
  >[number];

  interface TargetOnHostInput {
    available: readonly ReviewProviderCandidate[];
    entries: readonly RoutingEntry[];
    request: ReviewTargetRequest;
    loadModels: ReturnType<typeof catalogLoader>;
  }

  async function resolveTargetOnHost(
    input: TargetOnHostInput & { threadProviderId: string },
  ) {
    const resolution = await resolveReviewTarget(input);
    return resolution.ok ? targetFromResolution(resolution) : resolution;
  }

  function targetFromResolution(
    resolution: Extract<
      ReviewTargetResolution<ReviewProviderCandidate, CatalogModel>,
      { ok: true }
    >,
  ) {
    const reasoningLevel = appliedReasoningLevel(
      resolution.effort,
      resolution.model.supportedReasoningEfforts,
    );
    const target: ReviewTarget = {
      providerId: resolution.provider.id,
      providerName: resolution.provider.displayName,
      model: resolution.model.model,
      effort: resolution.effort,
      reasoningLevel,
      source: resolution.source,
    };
    return {
      ok: true as const,
      target,
      reasoningLevel,
      permissionMode: lowestSupportedPermissionMode(
        resolution.provider.permissionModes,
      ),
    };
  }

  async function hostReviewTarget(
    hostId: string | null,
    routing: RoutingSource,
  ): Promise<HostReviewTargetResult> {
    if (hostId === null) return { ok: false, error: "host_unavailable" };
    const available = await availableReviewProviders(hostId);
    if (available === null) return { ok: false, error: "host_unavailable" };
    const resolution = await resolveRoutedReviewTarget({
      available,
      entries: routing.ok ? routing.entries : [],
      request: reviewRequestFor(undefined),
      loadModels: catalogLoader(hostId),
    });
    if (resolution === null) return { ok: false, error: "thread_dependent" };
    if (!resolution.ok) return resolution;
    return { ok: true, ...targetFromResolution(resolution).target };
  }

  type ThreadReviewContext =
    | {
        ok: true;
        hostId: string;
        environmentId: string;
        thread: {
          id: string;
          projectId: string;
          providerId: string;
          title: string | null;
          titleFallback: string | null;
        };
        available: ReviewProviderCandidate[];
        entries: RoutingEntry[];
      }
    | { ok: false; error: ReviewError };

  async function threadReviewContext(
    threadId: string,
  ): Promise<ThreadReviewContext> {
    if (reviewThreadIds.has(threadId)) {
      return { ok: false, error: "review_of_review" };
    }
    const thread = await bb.sdk.threads.get({ threadId });
    const environmentId = thread.environmentId;
    if (environmentId === null) return { ok: false, error: "no_environment" };
    const hostId = await resolveHostIdForEnvironment(environmentId);
    if (hostId === null) return { ok: false, error: "host_unavailable" };
    const available = await availableReviewProviders(hostId);
    if (available === null) return { ok: false, error: "host_unavailable" };
    const routing = await readRoutingSource(hostId);
    return {
      ok: true,
      hostId,
      environmentId,
      thread: {
        id: thread.id,
        projectId: thread.projectId,
        providerId: thread.providerId,
        title: thread.title,
        titleFallback: thread.titleFallback,
      },
      available,
      entries: routing.ok ? routing.entries : [],
    };
  }

  async function reviewPreview(threadId: string) {
    const context = await threadReviewContext(threadId);
    if (!context.ok) return { target: context, options: [] };
    const loadModels = catalogLoader(context.hostId);
    const resolveFor = (request: ReviewTargetRequest) =>
      resolveTargetOnHost({
        available: context.available,
        entries: context.entries,
        request,
        threadProviderId: context.thread.providerId,
        loadModels,
      });
    const resolved = await resolveFor(reviewRequestFor(undefined));
    const options = await Promise.all(
      context.available.map((provider) =>
        resolveFor({ kind: "provider", providerId: provider.id }),
      ),
    );
    return {
      target: resolved.ok
        ? { ok: true as const, ...resolved.target }
        : resolved,
      options: options.flatMap((option) => (option.ok ? [option.target] : [])),
    };
  }

  async function collectFileChanges(
    threadId: string,
  ): Promise<TimelineFileChangeEntry[]> {
    const changes: TimelineFileChangeEntry[] = [];
    let beforeAnchorSeq: string | undefined;
    let beforeAnchorId: string | undefined;
    for (let page = 0; page < OUTPUTS_TIMELINE_MAX_PAGES; page += 1) {
      const timeline = await bb.sdk.threads.timeline({
        threadId,
        includeNestedRows: "true",
        segmentLimit: OUTPUTS_TIMELINE_SEGMENT_LIMIT,
        ...(beforeAnchorSeq !== undefined && beforeAnchorId !== undefined
          ? { beforeAnchorSeq, beforeAnchorId }
          : {}),
      });
      changes.push(...flattenFileChangeRows(timeline.rows).reverse());
      const olderCursor = timeline.timelinePage.olderCursor;
      if (!timeline.timelinePage.hasOlderRows || olderCursor === null) break;
      beforeAnchorSeq = String(olderCursor.anchorSeq);
      beforeAnchorId = olderCursor.anchorId;
    }
    return changes;
  }

  async function computeThreadSubagents(threadId: string) {
    const children = await bb.sdk.threads.list({
      parentThreadId: threadId,
      includeHidden: true,
      limit: SUBAGENT_LIST_LIMIT,
    });
    const subagents = children
      .map(subagentRow)
      .sort((left, right) =>
        left.updatedAt < right.updatedAt
          ? 1
          : left.updatedAt > right.updatedAt
            ? -1
            : 0,
      );
    return { subagents };
  }

  async function computeThreadOutputs(
    threadId: string,
  ): Promise<{ outputs: ThreadOutputTarget[] }> {
    const thread = await bb.sdk.threads.get({ threadId });
    const environmentId = thread.environmentId;
    if (environmentId === null) return { outputs: [] };
    const changes = await collectFileChanges(threadId);
    const created = extractCreatedFilePaths(changes);
    let hostId: string | null = null;
    if (created.some(isAbsoluteOutputPath)) {
      try {
        hostId = (await bb.sdk.environments.get({ environmentId })).hostId;
      } catch {
        hostId = null;
      }
    }
    const outputs: ThreadOutputTarget[] = [];
    for (const path of created) {
      if (isAbsoluteOutputPath(path)) {
        if (hostId !== null) outputs.push({ kind: "host", hostId, path });
        continue;
      }
      outputs.push({ kind: "workspace", environmentId, path });
    }
    return { outputs };
  }

  async function sendUserMessage(
    threadId: string,
    text: string,
  ): Promise<void> {
    await bb.sdk.threads.send({
      threadId,
      mode: "queue-if-active",
      input: [{ type: "text", text, mentions: [] }],
    });
  }

  async function readRoutingRow(
    role: AgentRole,
    hostId: string | null,
  ): Promise<RoutingRow> {
    if (hostId === null) return { ok: false, error: "host_unavailable" };
    try {
      return await host.call("readAgentModel", { role }, { hostId });
    } catch {
      return { ok: false, error: "call_failed" };
    }
  }

  async function selectProviderWithModels(
    hostId: string,
    available: readonly { id: string; displayName: string }[],
    requestedProviderId: string | null,
    roleModels: readonly string[],
  ): Promise<{
    provider: { id: string; displayName: string };
    models: { model: string; displayName: string }[];
  } | null> {
    const requested =
      requestedProviderId === null
        ? null
        : (available.find((provider) => provider.id === requestedProviderId) ??
          null);
    if (requested !== null) {
      const execution = await bb.sdk.providers.models({
        hostId,
        providerId: requested.id,
      });
      return { provider: requested, models: execution.models };
    }
    let fallback: {
      provider: { id: string; displayName: string };
      models: { model: string; displayName: string }[];
    } | null = null;
    for (const provider of available) {
      const execution = await bb.sdk.providers.models({
        hostId,
        providerId: provider.id,
      });
      fallback ??= { provider, models: execution.models };
      const ids = new Set(execution.models.map((model) => model.model));
      if (roleModels.some((model) => ids.has(model))) {
        return { provider, models: execution.models };
      }
    }
    return fallback;
  }

  async function routingModelCatalog(
    hostId: string | null,
    requestedProviderId: string | null,
    roleModels: readonly string[],
  ): Promise<{
    providers: { id: string; name: string }[];
    providerId: string | null;
    providerName: string | null;
    models: { id: string; displayName: string }[];
  }> {
    if (hostId === null) {
      return {
        providers: [],
        providerId: null,
        providerName: null,
        models: [],
      };
    }
    try {
      const allProviders = await bb.sdk.providers.list({ hostId });
      const available = allProviders.filter((provider) => provider.available);
      if (available.length === 0) {
        return {
          providers: [],
          providerId: null,
          providerName: null,
          models: [],
        };
      }
      const providers = available.map((provider) => ({
        id: provider.id,
        name: provider.displayName,
      }));
      const selection = await selectProviderWithModels(
        hostId,
        available,
        requestedProviderId,
        roleModels,
      );
      if (selection === null) {
        return { providers, providerId: null, providerName: null, models: [] };
      }
      return {
        providers,
        providerId: selection.provider.id,
        providerName: selection.provider.displayName,
        models: selection.models.map((model) => ({
          id: model.model,
          displayName: model.displayName,
        })),
      };
    } catch {
      return {
        providers: [],
        providerId: null,
        providerName: null,
        models: [],
      };
    }
  }

  async function requestReview(
    threadId: string,
    providerOverride: string | undefined,
  ): Promise<z.infer<typeof requestReviewResultSchema>> {
    const context = await threadReviewContext(threadId);
    if (!context.ok) return context;
    const { environmentId, thread } = context;
    const resolved = await resolveTargetOnHost({
      available: context.available,
      entries: context.entries,
      request: reviewRequestFor(providerOverride),
      threadProviderId: thread.providerId,
      loadModels: catalogLoader(context.hostId),
    });
    if (!resolved.ok) return resolved;
    const { target, reasoningLevel, permissionMode } = resolved;
    const diffScope = await diffScopeForThread(environmentId);
    const title = `Review: ${thread.title ?? thread.titleFallback ?? "thread"}`;
    const child = await bb.sdk.threads.spawn({
      projectId: thread.projectId,
      environment: { type: "reuse", environmentId },
      parentThreadId: threadId,
      providerId: target.providerId,
      model: target.model,
      ...(reasoningLevel === null ? {} : { reasoningLevel }),
      permissionMode,
      title,
      prompt: buildReviewPrompt(diffScope.diffCommand),
    });
    await markReviewThread(child.id);
    return { ok: true, reviewThreadId: child.id, ...target };
  }

  bb.rpc.register(workbenchRpcContract, {
    async runSpecCheck({ threadId }) {
      const command = await specCheckCommand(threadId);
      await sendUserMessage(threadId, command);
      return { command };
    },
    async runBugfix({ threadId, description }) {
      const command = `/bugfix ${description.trim()}`;
      await sendUserMessage(threadId, command);
      return { command };
    },
    requestReview({ threadId, providerId }) {
      return requestReview(threadId, providerId);
    },
    reviewProviderPreview({ threadId }) {
      return reviewPreview(threadId);
    },
    async setReviewProviderOption({ value }) {
      await bb.sdk.plugins.updateSettings({
        pluginId: bb.pluginId,
        values: { reviewProvider: value },
      });
      reviewProviderValue = value;
      return { value };
    },
    async runSpecInit({ threadId }) {
      const command = "/spec-init";
      await sendUserMessage(threadId, command);
      return { command };
    },
    async specInitBannerStatus({ threadId }) {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.environmentId === null) return { show: false };
      let environment;
      try {
        environment = await bb.sdk.environments.get({
          environmentId: thread.environmentId,
        });
      } catch {
        return { show: false };
      }
      if (environment.path === null) return { show: false };
      try {
        await bb.sdk.files.read({
          hostId: environment.hostId,
          path: `${environment.path}/${SPEC_PROJECT_FILE}`,
          rootPath: environment.path,
        });
        return { show: false };
      } catch (error) {
        return { show: errorCode(error) === "ENOENT" };
      }
    },
    async getRouting({ providerId: requestedProviderId }) {
      const hostId = await primaryHostId();
      const [scout, implementer, reviewer, routing] = await Promise.all([
        readRoutingRow("scout", hostId),
        readRoutingRow("implementer", hostId),
        readRoutingRow("reviewer", hostId),
        readRoutingSource(hostId),
      ]);
      const roleModels = [scout, implementer, reviewer]
        .filter((row): row is Extract<RoutingRow, { ok: true }> => row.ok)
        .map((row) => row.model);
      const [catalog, reviewTarget] = await Promise.all([
        routingModelCatalog(hostId, requestedProviderId, roleModels),
        hostReviewTarget(hostId, routing),
      ]);
      return {
        hostId,
        ...catalog,
        routing,
        scout,
        implementer,
        reviewer,
        reviewProvider: reviewProviderValue,
        reviewTarget,
      };
    },
    async setRouting({ role, model }): Promise<RoutingRow> {
      if (!isModelAllowedForRole(role, { id: model, displayName: model })) {
        return { ok: false, error: "not_allowed" };
      }
      const hostId = await primaryHostId();
      if (hostId === null) return { ok: false, error: "host_unavailable" };
      try {
        return await host.call("writeAgentModel", { role, model }, { hostId });
      } catch {
        return { ok: false, error: "call_failed" };
      }
    },
    async setRoutingEffort({ role, effort }): Promise<RoutingRow> {
      const hostId = await primaryHostId();
      if (hostId === null) return { ok: false, error: "host_unavailable" };
      try {
        return await host.call(
          "writeAgentEffort",
          { role, effort },
          { hostId },
        );
      } catch {
        return { ok: false, error: "call_failed" };
      }
    },
    getOrchestratedMode() {
      return { enabled: orchestratedMode };
    },
    async setOrchestratedMode({ enabled }) {
      await bb.sdk.plugins.updateSettings({
        pluginId: bb.pluginId,
        values: { orchestratedMode: enabled },
      });
      orchestratedMode = enabled;
      publishMultiModelModeChanged(enabled);
      return { enabled };
    },
    async listSpecs() {
      const hostId = await primaryHostId();
      const files =
        hostId === null
          ? []
          : await host
              .call("listSpecFiles", null, { hostId })
              .then((result) =>
                result.files.map((file) => ({ ...file, hostId })),
              )
              .catch(() => []);

      const [projectList, hosts] = await Promise.all([
        bb.sdk.projects.list(),
        bb.sdk.hosts.list(),
      ]);
      const connectedHostIds = new Set(
        hosts
          .filter((candidate) => candidate.status === "connected")
          .map((candidate) => candidate.id),
      );
      const candidates = projectSpecCandidates(
        projectList.map((project) => ({
          id: project.id,
          name: project.name,
          sources: project.sources,
        })),
        connectedHostIds,
      );
      const projects = (
        await Promise.all(
          candidates.map(async (candidate) => {
            try {
              await bb.sdk.files.read({
                hostId: candidate.hostId,
                path: candidate.path,
                rootPath: candidate.rootPath,
              });
              return {
                projectId: candidate.projectId,
                projectName: candidate.projectName,
                name: "PROJECT.md",
                path: candidate.path,
                hostId: candidate.hostId,
              };
            } catch {
              return null;
            }
          }),
        )
      ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      return { files, projects };
    },
    threadSubagents({ threadId }) {
      return computeThreadSubagents(threadId);
    },
    threadOutputs({ threadId }) {
      return computeThreadOutputs(threadId);
    },
  });

  async function setMultiModelModeFromCli(enabled: boolean): Promise<void> {
    await bb.sdk.plugins.updateSettings({
      pluginId: bb.pluginId,
      values: { orchestratedMode: enabled },
    });
    orchestratedMode = enabled;
    publishMultiModelModeChanged(enabled);
  }

  bb.cli.register({
    name: "workbench",
    summary:
      "Agent workflow shortcuts: model routing, multi-model mode, review",
    commands: [
      {
        name: "routing",
        summary:
          "Print the ROUTING.md roles with subagent frontmatter, or set a subagent's model or effort",
        usage:
          "bb workbench routing [set <role> <model> | effort <role> <level>]",
      },
      {
        name: "multimodel",
        summary: "Show or set multi-model mode",
        usage: "bb workbench multimodel <on|off>",
      },
      {
        name: "review",
        summary: "Spawn a cross-model review thread for a thread",
        usage: "bb workbench review <threadId> [--provider <id>]",
      },
      {
        name: "subagents",
        summary: "List a thread's subagents",
        usage: "bb workbench subagents <threadId>",
      },
      {
        name: "outputs",
        summary: "List files created by a thread's subagents",
        usage: "bb workbench outputs <threadId>",
      },
    ],
    async run(argv) {
      const [command, ...rest] = argv;
      if (command === "routing" && rest[0] === "set") {
        const [role, model] = rest.slice(1);
        if (role === undefined || model === undefined) {
          return {
            exitCode: 1,
            stderr: "Usage: bb workbench routing set <role> <model>",
          };
        }
        if (!isAgentRole(role)) {
          return {
            exitCode: 1,
            stderr: `Unknown role ${role}; expected one of ${AGENT_ROLES.join(", ")}`,
          };
        }
        if (!agentModelValueSchema.safeParse(model).success) {
          return { exitCode: 1, stderr: INVALID_MODEL_MESSAGE };
        }
        if (!isModelAllowedForRole(role, { id: model, displayName: model })) {
          return { exitCode: 1, stderr: disallowedModelMessage(role, model) };
        }
        const hostId = await primaryHostId();
        if (hostId === null) {
          return { exitCode: 1, stderr: "No connected host available" };
        }
        const result = await host.call(
          "writeAgentModel",
          { role, model },
          { hostId },
        );
        if (!result.ok) {
          return { exitCode: 1, stderr: result.error };
        }
        return { exitCode: 0, stdout: `${role}: ${result.model}` };
      }
      if (command === "routing" && rest[0] === "effort") {
        const [role, effort] = rest.slice(1);
        if (role === undefined || effort === undefined) {
          return {
            exitCode: 1,
            stderr: "Usage: bb workbench routing effort <role> <level>",
          };
        }
        if (!isAgentRole(role)) {
          return {
            exitCode: 1,
            stderr: `Unknown role ${role}; expected one of ${AGENT_ROLES.join(", ")}`,
          };
        }
        const level = agentEffortSchema.safeParse(effort);
        if (!level.success) {
          return {
            exitCode: 1,
            stderr: `Invalid effort ${effort}; expected one of ${agentEffortSchema.options.join(", ")}`,
          };
        }
        const hostId = await primaryHostId();
        if (hostId === null) {
          return { exitCode: 1, stderr: "No connected host available" };
        }
        const result = await host.call(
          "writeAgentEffort",
          { role, effort: level.data },
          { hostId },
        );
        if (!result.ok) {
          return { exitCode: 1, stderr: result.error };
        }
        return { exitCode: 0, stdout: `${role}: effort ${result.effort}` };
      }
      if (command === "routing" && rest.length === 0) {
        const hostId = await primaryHostId();
        const [routing, rows] = await Promise.all([
          readRoutingSource(hostId),
          Promise.all(
            AGENT_DISPLAY_ORDER.map(
              async (role) =>
                [role, await readRoutingRow(role, hostId)] as const,
            ),
          ),
        ]);
        const entries = routing.ok ? routing.entries : [];
        const architect = routingEntryFor(entries, "architect");
        const lines = [
          `source: ~/.claude/ROUTING.md${routing.ok ? "" : ` (${routing.error})`}`,
          `architect: ${architect === null ? "not in ROUTING.md" : describeRoutingEntry(architect)} (orchestrator thread, read-only)`,
        ];
        for (const [role, row] of rows) {
          const entry = routingEntryForAgent(entries, role);
          const parts = [
            row.ok
              ? `${row.model}${row.effort === null ? "" : ` · effort ${row.effort}`}`
              : row.error,
            `ROUTING.md: ${entry === null ? "none" : describeRoutingEntry(entry)}`,
          ];
          if (row.ok) {
            if (
              !isModelAllowedForRole(role, {
                id: row.model,
                displayName: row.model,
              })
            ) {
              parts.push("not allowed by ROUTING.md");
            }
            const drift = routingDrift(role, row.model, entries);
            if (drift !== null) {
              parts.push(`differs from ROUTING.md (${drift})`);
            }
          }
          lines.push(`${role}: ${parts.join(" | ")}`);
        }
        const reviewTarget = await hostReviewTarget(hostId, routing);
        lines.push(
          `cross-vendor reviewer: ${
            reviewTarget.ok
              ? `${reviewTarget.providerId} / ${reviewTarget.model}${reviewTarget.effort === null ? "" : ` · ${reviewTarget.effort}`} (source: ${reviewTarget.source})`
              : reviewTarget.error === "thread_dependent"
                ? THREAD_DEPENDENT_REVIEW_MESSAGE
                : reviewTarget.error
          } | setting: ${reviewProviderValue}`,
        );
        return { exitCode: 0, stdout: lines.join("\n") };
      }
      if (command === "multimodel") {
        const value = rest[0];
        if (value === "on" || value === "off") {
          await setMultiModelModeFromCli(value === "on");
        } else if (value !== undefined) {
          return {
            exitCode: 1,
            stderr: "Usage: bb workbench multimodel <on|off>",
          };
        }
        return {
          exitCode: 0,
          stdout: orchestratedMode ? "on" : "off",
        };
      }
      if (command === "review") {
        const parsed = parseReviewArgs(rest);
        if (parsed === null) {
          return {
            exitCode: 1,
            stderr: "Usage: bb workbench review <threadId> [--provider <id>]",
          };
        }
        const result = await requestReview(parsed.threadId, parsed.providerId);
        if (!result.ok) {
          return { exitCode: 1, stderr: result.error };
        }
        const level =
          result.reasoningLevel === null ? "" : `, ${result.reasoningLevel}`;
        return {
          exitCode: 0,
          stdout: `Started review thread ${result.reviewThreadId} with ${result.providerName} (${result.model}${level}) [${result.source}]`,
        };
      }
      if (command === "subagents") {
        const threadId = rest[0];
        if (threadId === undefined) {
          return {
            exitCode: 1,
            stderr: "Usage: bb workbench subagents <threadId>",
          };
        }
        const { subagents } = await computeThreadSubagents(threadId);
        if (subagents.length === 0) {
          return { exitCode: 0, stdout: "No subagents" };
        }
        const lines = subagents.map(
          (subagent) =>
            `${subagent.status}\t${subagent.title}\t${subagent.id}\t${subagent.updatedAt}`,
        );
        return { exitCode: 0, stdout: lines.join("\n") };
      }
      if (command === "outputs") {
        const threadId = rest[0];
        if (threadId === undefined) {
          return {
            exitCode: 1,
            stderr: "Usage: bb workbench outputs <threadId>",
          };
        }
        const { outputs } = await computeThreadOutputs(threadId);
        if (outputs.length === 0) {
          return { exitCode: 0, stdout: "No outputs" };
        }
        return {
          exitCode: 0,
          stdout: outputs.map((output) => output.path).join("\n"),
        };
      }
      return {
        exitCode: 1,
        stderr:
          "Usage: bb workbench <routing|routing set|routing effort|multimodel|review|subagents|outputs> [args]",
      };
    },
  });
}
