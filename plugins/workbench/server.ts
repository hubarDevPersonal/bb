import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  AGENT_MODEL_MAX_LENGTH,
  AGENT_ROLES,
  agentModelValueSchema,
  workbenchHostContract,
  type AgentRole,
} from "./contract.js";
import { projectSpecCandidates } from "./project-specs.js";
import {
  extractCreatedFilePaths,
  flattenFileChangeRows,
  subagentRow,
  type TimelineFileChangeEntry,
} from "./subagents-data.js";

const ORCHESTRATED_INSTRUCTIONS =
  "Orchestrated mode: act as the orchestrator — intent, plan, acceptance, " +
  "report. Delegate code reconnaissance to the `scout` subagent, " +
  "implementation of each task to `implementer`, and independent " +
  "verification to `reviewer`. One subagent per task, with the full " +
  "context in its prompt.";

const SPEC_PROJECT_FILE = ".claude/specs/PROJECT.md";

const INVALID_MODEL_MESSAGE =
  "Invalid model: expected a single token (letters, digits, " +
  `._:/[]-), up to ${AGENT_MODEL_MAX_LENGTH} characters`;

const routingErrorSchema = z.enum([
  "host_unavailable",
  "missing_file",
  "missing_frontmatter",
  "missing_model_key",
  "call_failed",
]);

type RoutingError = z.infer<typeof routingErrorSchema>;
type RoutingRow =
  | { ok: true; model: string }
  | { ok: false; error: RoutingError };

const routingRowSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), model: z.string() }).strict(),
  z.object({ ok: z.literal(false), error: routingErrorSchema }).strict(),
]) satisfies z.ZodType<RoutingRow>;

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
    scout: routingRowSchema,
    implementer: routingRowSchema,
    reviewer: routingRowSchema,
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

const threadOutputRowSchema = z
  .object({ path: z.string(), environmentId: z.string() })
  .strict();

export const workbenchRpcContract = defineRpcContract({
  runSpecCheck: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ command: z.string() }).strict(),
  },
  runTask: {
    input: z
      .object({ threadId: z.string().min(1), description: z.string().min(1) })
      .strict(),
    output: z.object({ command: z.string() }).strict(),
  },
  runBugfix: {
    input: z
      .object({ threadId: z.string().min(1), description: z.string().min(1) })
      .strict(),
    output: z.object({ command: z.string() }).strict(),
  },
  runGoal: {
    input: z
      .object({
        threadId: z.string().min(1),
        goal: z.string().min(1),
        maxTasks: z.number().int().min(1).max(12),
      })
      .strict(),
    output: z.object({ message: z.string() }).strict(),
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

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

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
      label: "Orchestrated mode",
      description:
        "Ask agents to delegate reconnaissance, implementation, and review " +
        "to subagents. Applies to new sessions.",
      default: false,
    },
  });
  let orchestratedMode = (await settings.get()).orchestratedMode;
  settings.onChange((next) => {
    orchestratedMode = next.orchestratedMode;
  });

  bb.agents.contributeInstructions(() =>
    orchestratedMode ? ORCHESTRATED_INSTRUCTIONS : null,
  );

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

  bb.rpc.register(workbenchRpcContract, {
    async runSpecCheck({ threadId }) {
      const command = await specCheckCommand(threadId);
      await sendUserMessage(threadId, command);
      return { command };
    },
    async runTask({ threadId, description }) {
      const command = `/task ${description.trim()}`;
      await sendUserMessage(threadId, command);
      return { command };
    },
    async runBugfix({ threadId, description }) {
      const command = `/bugfix ${description.trim()}`;
      await sendUserMessage(threadId, command);
      return { command };
    },
    async runGoal({ threadId, goal, maxTasks }) {
      const args = JSON.stringify({ goal, maxTasks });
      const message =
        "Run the goal workflow and post its run card: " +
        `bb workflows run --name goal --args ${shellSingleQuote(args)}`;
      await sendUserMessage(threadId, message);
      return { message };
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
      const [scout, implementer, reviewer] = await Promise.all([
        readRoutingRow("scout", hostId),
        readRoutingRow("implementer", hostId),
        readRoutingRow("reviewer", hostId),
      ]);
      const roleModels = [scout, implementer, reviewer]
        .filter((row): row is Extract<RoutingRow, { ok: true }> => row.ok)
        .map((row) => row.model);
      const catalog = await routingModelCatalog(
        hostId,
        requestedProviderId,
        roleModels,
      );
      return { hostId, ...catalog, scout, implementer, reviewer };
    },
    async setRouting({ role, model }): Promise<RoutingRow> {
      const hostId = await primaryHostId();
      if (hostId === null) return { ok: false, error: "host_unavailable" };
      try {
        return await host.call("writeAgentModel", { role, model }, { hostId });
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
    async threadSubagents({ threadId }) {
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
    },
    async threadOutputs({ threadId }) {
      const thread = await bb.sdk.threads.get({ threadId });
      const environmentId = thread.environmentId;
      if (environmentId === null) return { outputs: [] };
      const changes = await collectFileChanges(threadId);
      const outputs = extractCreatedFilePaths(changes).map((path) => ({
        path,
        environmentId,
      }));
      return { outputs };
    },
  });

  async function setOrchestratedModeFromCli(enabled: boolean): Promise<void> {
    await bb.sdk.plugins.updateSettings({
      pluginId: bb.pluginId,
      values: { orchestratedMode: enabled },
    });
    orchestratedMode = enabled;
  }

  bb.cli.register({
    name: "workbench",
    summary: "Agent workflow shortcuts: model routing and orchestrated mode",
    commands: [
      {
        name: "routing",
        summary: "Print or set the role -> model routing",
        usage: "bb workbench routing [set <role> <model>]",
      },
      {
        name: "orchestrated",
        summary: "Show or set orchestrated mode",
        usage: "bb workbench orchestrated <on|off>",
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
      if (command === "routing" && rest.length === 0) {
        const hostId = await primaryHostId();
        const lines = await Promise.all(
          AGENT_ROLES.map(async (role) => {
            const row = await readRoutingRow(role, hostId);
            return `${role}: ${row.ok ? row.model : row.error}`;
          }),
        );
        return { exitCode: 0, stdout: lines.join("\n") };
      }
      if (command === "orchestrated") {
        const value = rest[0];
        if (value === "on" || value === "off") {
          await setOrchestratedModeFromCli(value === "on");
        } else if (value !== undefined) {
          return {
            exitCode: 1,
            stderr: "Usage: bb workbench orchestrated <on|off>",
          };
        }
        return {
          exitCode: 0,
          stdout: orchestratedMode ? "on" : "off",
        };
      }
      return {
        exitCode: 1,
        stderr: "Usage: bb workbench <routing|routing set|orchestrated> [args]",
      };
    },
  });
}
