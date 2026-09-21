import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { ROUTING_FIXTURE } from "./__fixtures__/routing.js";
import { WORKBENCH_SUBAGENTS_REALTIME_CHANNEL } from "./realtime-channel.js";
import plugin from "./server.js";

function threadRecord(environmentId: string | null) {
  return { id: "thr_1", environmentId };
}

const PERMISSIVE_CAPABILITIES = {
  permissionModes: ["accept-edits", "auto", "full"],
} as const;

function catalogModel(
  model: string,
  options: {
    isDefault?: boolean;
    efforts?: ("low" | "medium" | "high")[];
  } = {},
) {
  return {
    model,
    displayName: model,
    isDefault: options.isDefault ?? false,
    supportedReasoningEfforts: (options.efforts ?? []).map(
      (reasoningEffort) => ({ reasoningEffort, description: reasoningEffort }),
    ),
  };
}

const EFFORTS = ["low", "medium", "high"] as const;

const ROUTING_CATALOGS: Record<string, ReturnType<typeof catalogModel>[]> = {
  "claude-code": [
    catalogModel("claude-sonnet-5", { isDefault: true, efforts: [...EFFORTS] }),
    catalogModel("claude-fable-5-1", { efforts: [...EFFORTS] }),
    catalogModel("claude-opus-5", { efforts: [...EFFORTS] }),
  ],
  codex: [
    catalogModel("gpt-5", { isDefault: true, efforts: [...EFFORTS] }),
    catalogModel("gpt-5.6-sol", { efforts: ["medium", "high"] }),
  ],
  pi: [catalogModel("pi-model", { isDefault: true })],
};

function routingProvidersSdk(available: readonly string[]) {
  return {
    list: async () =>
      [
        { id: "claude-code", displayName: "Claude Code" },
        { id: "codex", displayName: "Codex" },
        { id: "pi", displayName: "Pi" },
      ].map((provider) => ({
        ...provider,
        available: available.includes(provider.id),
        capabilities: PERMISSIVE_CAPABILITIES,
      })),
    models: async (args?: { providerId?: string }) => ({
      models: ROUTING_CATALOGS[args?.providerId ?? ""] ?? [],
      selectedOnlyModels: [],
    }),
  };
}

const ROUTING_PROVIDERS_SDK = routingProvidersSdk(["claude-code", "codex"]);

function routingHostRpc({ method }: { method: string }) {
  if (method === "readRouting") return { ok: true, markdown: ROUTING_FIXTURE };
  if (method === "readAgentModel") {
    return { ok: true, model: "claude-opus-5", effort: null };
  }
  throw new Error(`unexpected host RPC method ${method}`);
}

function reviewThreadSdk(onSpawn: (args: unknown) => void) {
  return {
    get: async () =>
      makeThreadResponse({
        id: "thr_1",
        projectId: "proj_1",
        environmentId: "env_1",
        providerId: "claude-code",
        title: "Fix the bug",
      }),
    spawn: async (args: unknown) => {
      onSpawn(args);
      return makeThreadResponse({ id: "thr_review" });
    },
  };
}

type RequestReviewResult =
  | {
      ok: true;
      reviewThreadId: string;
      providerId: string;
      providerName: string;
    }
  | { ok: false; error: string };

describe("workbench spec-check command", () => {
  it("targets the working tree for a non-worktree thread", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () => threadRecord("env_1"),
          send: async () => ({ ok: true, delivery: "sent" }),
        },
        environments: {
          get: async () => ({
            id: "env_1",
            hostId: "host_1",
            path: "/work/repo",
            isWorktree: false,
            branchName: "main",
            baseBranch: null,
            defaultBranch: "main",
            mergeBaseBranch: null,
          }),
        },
      },
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("runSpecCheck", { threadId: "thr_1" }),
    ).resolves.toEqual({ command: "/spec-check" });
    await host.harness.dispose();
  });

  it("diffs against the merge-base branch for a worktree thread", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () => threadRecord("env_1"),
          send: async () => ({ ok: true, delivery: "sent" }),
        },
        environments: {
          get: async () => ({
            id: "env_1",
            hostId: "host_1",
            path: "/work/repo-wt",
            isWorktree: true,
            branchName: "feature/x",
            baseBranch: "main",
            defaultBranch: "main",
            mergeBaseBranch: "main",
          }),
        },
      },
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("runSpecCheck", { threadId: "thr_1" }),
    ).resolves.toEqual({ command: "/spec-check main..feature/x" });
    const sendCalls = host.harness.sdk.callsTo("threads.send");
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]![0]).toMatchObject({
      threadId: "thr_1",
      mode: "queue-if-active",
      input: [{ type: "text", text: "/spec-check main..feature/x" }],
    });
    await host.harness.dispose();
  });

  it("falls back to a plain spec-check when the thread has no environment", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () => threadRecord(null),
          send: async () => ({ ok: true, delivery: "sent" }),
        },
      },
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("runSpecCheck", { threadId: "thr_1" }),
    ).resolves.toEqual({ command: "/spec-check" });
    await host.harness.dispose();
  });
});

describe("workbench multi-model mode instructions", () => {
  it("contributes instructions only while the setting is on", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    const ctx = { threadId: "thr_1", projectId: "proj_1" };
    const provider = host.harness.registrations.instructionProvider;
    if (provider === null) throw new Error("expected an instruction provider");

    expect(provider(ctx)).toBeNull();

    await host.harness.setSettings({ orchestratedMode: true });
    expect(provider(ctx)).toContain("Multi-model mode: orchestrate");
    expect(provider(ctx)).toContain("bb workbench review <this thread id>");

    await host.harness.setSettings({ orchestratedMode: false });
    expect(provider(ctx)).toBeNull();

    await host.harness.dispose();
  });

  it("updates its own setting and reflects it through the RPC", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        plugins: {
          updateSettings: async ({ values }) => {
            await host.harness.setSettings(values as Record<string, boolean>);
            return {} as never;
          },
        },
      },
    });
    await plugin(host.bb);

    await expect(host.harness.callRpc("getOrchestratedMode")).resolves.toEqual({
      enabled: false,
    });
    await expect(
      host.harness.callRpc("setOrchestratedMode", { enabled: true }),
    ).resolves.toEqual({ enabled: true });
    await expect(host.harness.callRpc("getOrchestratedMode")).resolves.toEqual({
      enabled: true,
    });

    await host.harness.dispose();
  });

  it("does not contribute instructions to a thread it spawned as a cross-model review", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              projectId: "proj_1",
              environmentId: "env_1",
              providerId: "claude-code",
              title: "Fix the bug",
            }),
          spawn: async () => makeThreadResponse({ id: "thr_review" }),
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "codex",
              displayName: "Codex",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
          ],
          models: async () => ({
            models: [{ model: "gpt-5", displayName: "GPT-5", isDefault: true }],
            selectedOnlyModels: [],
          }),
        },
      },
    });
    await plugin(host.bb);
    await host.harness.setSettings({ orchestratedMode: true });
    const provider = host.harness.registrations.instructionProvider;
    if (provider === null) throw new Error("expected an instruction provider");
    expect(provider({ threadId: "thr_1", projectId: "proj_1" })).toContain(
      "Multi-model mode: orchestrate",
    );

    const result = (await host.harness.callRpc("requestReview", {
      threadId: "thr_1",
    })) as RequestReviewResult;
    if (!result.ok) throw new Error("expected requestReview to succeed");
    expect(
      provider({ threadId: result.reviewThreadId, projectId: "proj_1" }),
    ).toBeNull();

    await host.harness.dispose();
  });

  it("keeps the review-thread guard across a plugin reload", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              projectId: "proj_1",
              environmentId: "env_1",
              providerId: "claude-code",
              title: "Fix the bug",
            }),
          spawn: async () => makeThreadResponse({ id: "thr_review" }),
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "codex",
              displayName: "Codex",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
          ],
          models: async () => ({
            models: [{ model: "gpt-5", displayName: "GPT-5", isDefault: true }],
            selectedOnlyModels: [],
          }),
        },
      },
    });
    await plugin(host.bb);
    await host.harness.setSettings({ orchestratedMode: true });
    const result = (await host.harness.callRpc("requestReview", {
      threadId: "thr_1",
    })) as RequestReviewResult;
    if (!result.ok) throw new Error("expected requestReview to succeed");

    const reloaded = await host.harness.reload(plugin);
    const provider = reloaded.harness.registrations.instructionProvider;
    if (provider === null) throw new Error("expected an instruction provider");
    expect(
      provider({ threadId: result.reviewThreadId, projectId: "proj_1" }),
    ).toBeNull();

    await reloaded.harness.dispose();
  });
});

describe("workbench model routing catalog", () => {
  it("sources the model catalog from the available provider on the primary host", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: {
          list: async () => [{ id: "host_1", status: "connected" }],
        },
        providers: {
          list: async () => [
            { id: "codex", displayName: "Codex", available: false },
            { id: "claude-code", displayName: "Claude Code", available: true },
          ],
          models: async () => ({
            models: [{ model: "sonnet", displayName: "Sonnet" }],
            selectedOnlyModels: [],
          }),
        },
      },
      experimental_callHostRpc: ({ method }) => {
        if (method === "readAgentModel") {
          return { ok: true, model: "haiku", effort: null };
        }
        throw new Error(`unexpected host RPC method ${method}`);
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("getRouting", {
      providerId: null,
    });
    expect(result).toMatchObject({
      hostId: "host_1",
      providers: [{ id: "claude-code", name: "Claude Code" }],
      providerId: "claude-code",
      providerName: "Claude Code",
      models: [{ id: "sonnet", displayName: "Sonnet" }],
    });
    await host.harness.dispose();
  });

  it("returns an empty catalog when no host is connected", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: { hosts: { list: async () => [] } },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("getRouting", {
      providerId: null,
    });
    expect(result).toMatchObject({
      hostId: null,
      providers: [],
      providerId: null,
      providerName: null,
      models: [],
    });
    await host.harness.dispose();
  });

  it("selects the provider whose catalog contains a current role model, not just the first available", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: {
          list: async () => [{ id: "host_1", status: "connected" }],
        },
        providers: {
          list: async () => [
            { id: "codex", displayName: "Codex", available: true },
            { id: "claude-code", displayName: "Claude Code", available: true },
          ],
          models: async (args) => {
            if (args?.providerId === "codex") {
              return {
                models: [{ model: "gpt-5", displayName: "GPT-5" }],
                selectedOnlyModels: [],
              };
            }
            return {
              models: [{ model: "opus", displayName: "Opus" }],
              selectedOnlyModels: [],
            };
          },
        },
      },
      experimental_callHostRpc: ({ method, input }) => {
        if (method === "readAgentModel") {
          return { ok: true, model: "opus", effort: null };
        }
        throw new Error(
          `unexpected host RPC method ${method} ${JSON.stringify(input)}`,
        );
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("getRouting", {
      providerId: null,
    });
    expect(result).toMatchObject({
      providers: [
        { id: "codex", name: "Codex" },
        { id: "claude-code", name: "Claude Code" },
      ],
      providerId: "claude-code",
      providerName: "Claude Code",
      models: [{ id: "opus", displayName: "Opus" }],
    });
    await host.harness.dispose();
  });

  it("honors an explicit providerId argument", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: {
          list: async () => [{ id: "host_1", status: "connected" }],
        },
        providers: {
          list: async () => [
            { id: "codex", displayName: "Codex", available: true },
            { id: "claude-code", displayName: "Claude Code", available: true },
          ],
          models: async (args) => ({
            models: [
              {
                model: `${args?.providerId}-model`,
                displayName: args?.providerId ?? "",
              },
            ],
            selectedOnlyModels: [],
          }),
        },
      },
      experimental_callHostRpc: ({ method }) => {
        if (method === "readAgentModel") {
          return { ok: true, model: "opus", effort: null };
        }
        throw new Error(`unexpected host RPC method ${method}`);
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("getRouting", {
      providerId: "codex",
    });
    expect(result).toMatchObject({
      providerId: "codex",
      models: [{ id: "codex-model", displayName: "codex" }],
    });
    await host.harness.dispose();
  });
});

describe("workbench specs listing", () => {
  it("lists PROJECT.md for local-path project sources on connected hosts only, skipping missing files", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: {
          list: async () => [
            { id: "host_1", status: "connected" },
            { id: "host_2", status: "disconnected" },
          ],
        },
        projects: {
          list: async () => [
            {
              id: "proj_1",
              name: "bb",
              sources: [
                { type: "local_path", hostId: "host_1", path: "/work/bb" },
              ],
            },
            {
              id: "proj_2",
              name: "offline-project",
              sources: [
                {
                  type: "local_path",
                  hostId: "host_2",
                  path: "/work/offline",
                },
              ],
            },
            {
              id: "proj_3",
              name: "no-spec-yet",
              sources: [
                { type: "local_path", hostId: "host_1", path: "/work/none" },
              ],
            },
          ],
        },
        files: {
          read: async ({ path }: { path: string }) => {
            if (path === "/work/bb/.claude/specs/PROJECT.md") return {};
            throw Object.assign(new Error("not found"), { code: "ENOENT" });
          },
        },
      },
      experimental_callHostRpc: ({ method }) => {
        if (method === "listSpecFiles") return { files: [] };
        throw new Error(`unexpected host RPC method ${method}`);
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("listSpecs");
    expect(result).toEqual({
      files: [],
      projects: [
        {
          projectId: "proj_1",
          projectName: "bb",
          name: "PROJECT.md",
          path: "/work/bb/.claude/specs/PROJECT.md",
          hostId: "host_1",
        },
      ],
    });
    await host.harness.dispose();
  });
});

describe("workbench thread subagents", () => {
  it("maps hidden child threads to subagent rows sorted by recency", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          list: async () => [
            {
              id: "thr_a",
              title: "Investigate flaky test",
              titleFallback: null,
              updatedAt: 1000,
              runtime: { displayStatus: "active" },
            },
            {
              id: "thr_b",
              title: null,
              titleFallback: null,
              updatedAt: 2000,
              runtime: { displayStatus: "idle" },
            },
          ],
        },
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("threadSubagents", {
      threadId: "thr_parent",
    });
    expect(result).toEqual({
      subagents: [
        {
          id: "thr_b",
          title: "Subagent thr_b",
          status: "done",
          updatedAt: new Date(2000).toISOString(),
        },
        {
          id: "thr_a",
          title: "Investigate flaky test",
          status: "active",
          updatedAt: new Date(1000).toISOString(),
        },
      ],
    });
    const listCalls = host.harness.sdk.callsTo("threads.list");
    expect(listCalls[0]![0]).toMatchObject({
      parentThreadId: "thr_parent",
      includeHidden: true,
    });
    await host.harness.dispose();
  });
});

describe("workbench thread outputs", () => {
  it("returns created files, walking turn children and dropping merely-updated ones", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () => ({ environmentId: "env_1" }),
          timeline: async () => ({
            rows: [
              {
                kind: "turn",
                children: [
                  {
                    kind: "work",
                    workKind: "file-change",
                    change: { path: "src/a.ts", kind: "add" },
                  },
                ],
              },
              {
                kind: "work",
                workKind: "file-change",
                change: { path: "src/b.ts", kind: "update" },
              },
            ],
            timelinePage: { hasOlderRows: false, olderCursor: null },
          }),
        },
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("threadOutputs", {
      threadId: "thr_1",
    });
    expect(result).toEqual({
      outputs: [
        { kind: "workspace", path: "src/a.ts", environmentId: "env_1" },
      ],
    });
    await host.harness.dispose();
  });

  it("returns no outputs when the thread has no environment", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: { threads: { get: async () => ({ environmentId: null }) } },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("threadOutputs", {
      threadId: "thr_1",
    });
    expect(result).toEqual({ outputs: [] });
    await host.harness.dispose();
  });

  it("descends into a delegation row's childRows to find a subagent's created file", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () => ({ environmentId: "env_1" }),
          timeline: async () => ({
            rows: [
              {
                kind: "work",
                workKind: "delegation",
                childRows: [
                  {
                    kind: "work",
                    workKind: "file-change",
                    change: { path: "src/nested.ts", kind: "add" },
                  },
                ],
              },
            ],
            timelinePage: { hasOlderRows: false, olderCursor: null },
          }),
        },
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("threadOutputs", {
      threadId: "thr_1",
    });
    expect(result).toEqual({
      outputs: [
        { kind: "workspace", path: "src/nested.ts", environmentId: "env_1" },
      ],
    });
    await host.harness.dispose();
  });

  it("targets a host file for a path outside the workspace", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () => ({ environmentId: "env_1" }),
          timeline: async () => ({
            rows: [
              {
                kind: "work",
                workKind: "file-change",
                change: { path: "/tmp/out.txt", kind: "add" },
              },
            ],
            timelinePage: { hasOlderRows: false, olderCursor: null },
          }),
        },
        environments: {
          get: async () => ({ hostId: "host_1" }),
        },
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("threadOutputs", {
      threadId: "thr_1",
    });
    expect(result).toEqual({
      outputs: [{ kind: "host", path: "/tmp/out.txt", hostId: "host_1" }],
    });
    await host.harness.dispose();
  });

  it("pages through the timeline newest-first, dropping a delete on a newer page against an add on an older page", async () => {
    const timelineCalls: unknown[] = [];
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () => ({ environmentId: "env_1" }),
          timeline: async (args: unknown) => {
            timelineCalls.push(args);
            const { beforeAnchorSeq } = args as {
              beforeAnchorSeq?: string;
            };
            if (beforeAnchorSeq === undefined) {
              return {
                rows: [
                  {
                    kind: "work",
                    workKind: "file-change",
                    change: { path: "src/same.ts", kind: "delete" },
                  },
                ],
                timelinePage: {
                  hasOlderRows: true,
                  olderCursor: { anchorSeq: 2, anchorId: "row_2" },
                },
              };
            }
            if (beforeAnchorSeq === "2") {
              return {
                rows: [
                  {
                    kind: "work",
                    workKind: "file-change",
                    change: { path: "src/same.ts", kind: "add" },
                  },
                  {
                    kind: "work",
                    workKind: "file-change",
                    change: { path: "src/keep.ts", kind: "add" },
                  },
                ],
                timelinePage: {
                  hasOlderRows: true,
                  olderCursor: { anchorSeq: 1, anchorId: "row_1" },
                },
              };
            }
            return {
              rows: [
                {
                  kind: "work",
                  workKind: "file-change",
                  change: { path: "src/late.ts", kind: "add" },
                },
              ],
              timelinePage: {
                hasOlderRows: true,
                olderCursor: { anchorSeq: 0, anchorId: "row_0" },
              },
            };
          },
        },
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("threadOutputs", {
      threadId: "thr_1",
    });
    expect(result).toEqual({
      outputs: [
        { kind: "workspace", path: "src/keep.ts", environmentId: "env_1" },
        { kind: "workspace", path: "src/late.ts", environmentId: "env_1" },
      ],
    });
    expect(timelineCalls).toHaveLength(3);
    expect(timelineCalls[1]).toMatchObject({
      beforeAnchorSeq: "2",
      beforeAnchorId: "row_2",
    });
    expect(timelineCalls[2]).toMatchObject({
      beforeAnchorSeq: "1",
      beforeAnchorId: "row_1",
    });
    await host.harness.dispose();
  });
});

describe("workbench spec-init banner status", () => {
  it("shows the banner when the project spec file is missing", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: { get: async () => threadRecord("env_1") },
        environments: {
          get: async () => ({
            id: "env_1",
            hostId: "host_1",
            path: "/work/repo",
            isWorktree: false,
            branchName: "main",
            baseBranch: null,
            defaultBranch: "main",
            mergeBaseBranch: null,
          }),
        },
        files: {
          read: async () => {
            throw Object.assign(new Error("not found"), { code: "ENOENT" });
          },
        },
      },
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("specInitBannerStatus", { threadId: "thr_1" }),
    ).resolves.toEqual({ show: true });
    await host.harness.dispose();
  });

  it("hides the banner on a non-ENOENT read error", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: { get: async () => threadRecord("env_1") },
        environments: {
          get: async () => ({
            id: "env_1",
            hostId: "host_1",
            path: "/work/repo",
            isWorktree: false,
            branchName: "main",
            baseBranch: null,
            defaultBranch: "main",
            mergeBaseBranch: null,
          }),
        },
        files: {
          read: async () => {
            throw Object.assign(new Error("permission denied"), {
              code: "EACCES",
            });
          },
        },
      },
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("specInitBannerStatus", { threadId: "thr_1" }),
    ).resolves.toEqual({ show: false });
    await host.harness.dispose();
  });
});

describe("workbench review provider resolution", () => {
  it("auto mode picks the first available provider that differs from the thread's own", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              providerId: "claude-code",
            }),
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "claude-code",
              displayName: "Claude Code",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
            {
              id: "codex",
              displayName: "Codex",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
          ],
          models: async (args) => ({
            models: [
              catalogModel(`${args?.providerId}-default`, { isDefault: true }),
            ],
            selectedOnlyModels: [],
          }),
        },
      },
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("reviewProviderPreview", { threadId: "thr_1" }),
    ).resolves.toEqual({
      target: {
        ok: true,
        providerId: "codex",
        providerName: "Codex",
        model: "codex-default",
        effort: null,
        reasoningLevel: null,
        source: "fallback",
      },
      options: [
        {
          providerId: "claude-code",
          providerName: "Claude Code",
          model: "claude-code-default",
          effort: null,
          reasoningLevel: null,
          source: "provider-default",
        },
        {
          providerId: "codex",
          providerName: "Codex",
          model: "codex-default",
          effort: null,
          reasoningLevel: null,
          source: "provider-default",
        },
      ],
    });
    await host.harness.dispose();
  });

  it("auto mode errors when no other provider is available", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              providerId: "claude-code",
            }),
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "claude-code",
              displayName: "Claude Code",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
            { id: "codex", displayName: "Codex", available: false },
          ],
        },
      },
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("reviewProviderPreview", { threadId: "thr_1" }),
    ).resolves.toEqual({
      target: { ok: false, error: "no_provider_available" },
      options: [],
    });
    await host.harness.dispose();
  });

  it("honors an explicit reviewProvider setting", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              providerId: "claude-code",
            }),
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "claude-code",
              displayName: "Claude Code",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
            {
              id: "codex",
              displayName: "Codex",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
          ],
          models: async () => ({
            models: [catalogModel("default-model", { isDefault: true })],
            selectedOnlyModels: [],
          }),
        },
      },
    });
    await plugin(host.bb);
    await host.harness.setSettings({ reviewProvider: "claude-code" });
    await expect(
      host.harness.callRpc("reviewProviderPreview", { threadId: "thr_1" }),
    ).resolves.toMatchObject({
      target: {
        ok: true,
        providerId: "claude-code",
        providerName: "Claude Code",
        model: "default-model",
        source: "provider-default",
      },
    });
    await host.harness.dispose();
  });

  it("errors when the explicit reviewProvider is not available", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              providerId: "claude-code",
            }),
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "claude-code",
              displayName: "Claude Code",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
          ],
        },
      },
    });
    await plugin(host.bb);
    await host.harness.setSettings({ reviewProvider: "codex" });
    await expect(
      host.harness.callRpc("reviewProviderPreview", { threadId: "thr_1" }),
    ).resolves.toMatchObject({
      target: { ok: false, error: "provider_unavailable" },
    });
    await host.harness.dispose();
  });

  it("errors with no_environment when the thread has no environment", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () => makeThreadResponse({ id: "thr_1" }),
        },
      },
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("reviewProviderPreview", { threadId: "thr_1" }),
    ).resolves.toEqual({
      target: { ok: false, error: "no_environment" },
      options: [],
    });
    await host.harness.dispose();
  });
});

describe("workbench review provider settings", () => {
  it("persists the setting via plugins.updateSettings and changes the next preview", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        plugins: {
          updateSettings: async ({ values }) => {
            await host.harness.setSettings(values as Record<string, string>);
            return {} as never;
          },
        },
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              providerId: "claude-code",
            }),
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "claude-code",
              displayName: "Claude Code",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
            {
              id: "codex",
              displayName: "Codex",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
          ],
          models: async () => ({
            models: [catalogModel("default-model", { isDefault: true })],
            selectedOnlyModels: [],
          }),
        },
      },
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("setReviewProviderOption", {
        value: "claude-code",
      }),
    ).resolves.toEqual({ value: "claude-code" });
    await expect(
      host.harness.callRpc("reviewProviderPreview", { threadId: "thr_1" }),
    ).resolves.toMatchObject({
      target: {
        ok: true,
        providerId: "claude-code",
        providerName: "Claude Code",
      },
    });
    await host.harness.dispose();
  });
});

describe("workbench requestReview spawn", () => {
  it("spawns a child thread reusing the environment, with parentThreadId and the diff range in the prompt", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              projectId: "proj_1",
              environmentId: "env_1",
              providerId: "claude-code",
              title: "Fix the bug",
            }),
          spawn: async (args: unknown) => {
            spawnArgs = args;
            return makeThreadResponse({ id: "thr_review" });
          },
        },
        environments: {
          get: async () => ({
            id: "env_1",
            hostId: "host_1",
            path: "/work/repo-wt",
            isWorktree: true,
            branchName: "feature/x",
            baseBranch: "main",
            defaultBranch: "main",
            mergeBaseBranch: "main",
          }),
        },
        providers: {
          list: async () => [
            {
              id: "claude-code",
              displayName: "Claude Code",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
            {
              id: "codex",
              displayName: "Codex",
              available: true,
              capabilities: { permissionModes: ["full"] },
            },
          ],
          models: async () => ({
            models: [
              { model: "sonnet", displayName: "Sonnet", isDefault: false },
              { model: "gpt-5", displayName: "GPT-5", isDefault: true },
            ],
            selectedOnlyModels: [],
          }),
        },
      },
    });
    let spawnArgs: unknown;
    await plugin(host.bb);
    const result = await host.harness.callRpc("requestReview", {
      threadId: "thr_1",
    });
    expect(result).toEqual({
      ok: true,
      reviewThreadId: "thr_review",
      providerId: "codex",
      providerName: "Codex",
      model: "gpt-5",
      effort: null,
      reasoningLevel: null,
      source: "fallback",
    });
    expect(spawnArgs).toMatchObject({
      projectId: "proj_1",
      environment: { type: "reuse", environmentId: "env_1" },
      parentThreadId: "thr_1",
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "full",
      title: "Review: Fix the bug",
    });
    const prompt = (spawnArgs as { prompt: string }).prompt;
    expect(prompt).toContain("git diff main...feature/x");
    expect(prompt).toContain("Do not modify files");
    expect(prompt).toContain("do not run `bb workbench review`");
    await host.harness.dispose();
  });

  it("picks the lowest permission mode the review provider supports", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              projectId: "proj_1",
              environmentId: "env_1",
              providerId: "claude-code",
              title: "Fix the bug",
            }),
          spawn: async (args: unknown) => {
            spawnArgs = args;
            return makeThreadResponse({ id: "thr_review" });
          },
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "claude-code",
              displayName: "Claude Code",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
            {
              id: "pi",
              displayName: "Pi",
              available: true,
              capabilities: { permissionModes: ["full"] },
            },
          ],
          models: async () => ({
            models: [{ model: "pi-model", displayName: "Pi", isDefault: true }],
            selectedOnlyModels: [],
          }),
        },
      },
    });
    let spawnArgs: unknown;
    await plugin(host.bb);
    await host.harness.callRpc("requestReview", { threadId: "thr_1" });
    expect(spawnArgs).toMatchObject({
      providerId: "pi",
      permissionMode: "full",
    });
    await host.harness.dispose();
  });

  it("errors with no_environment and does not spawn when the thread has no environment", async () => {
    let spawnCalled = false;
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              projectId: "proj_1",
              environmentId: null,
              providerId: "claude-code",
              title: null,
              titleFallback: "Untitled",
            }),
          spawn: async () => {
            spawnCalled = true;
            return makeThreadResponse({ id: "thr_review" });
          },
        },
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("requestReview", {
      threadId: "thr_1",
    });
    expect(result).toEqual({ ok: false, error: "no_environment" });
    expect(spawnCalled).toBe(false);
    await host.harness.dispose();
  });

  it("errors with provider_unavailable and does not spawn when the model catalog is empty", async () => {
    let spawnCalled = false;
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              projectId: "proj_1",
              environmentId: "env_1",
              providerId: "claude-code",
              title: "Fix the bug",
            }),
          spawn: async () => {
            spawnCalled = true;
            return makeThreadResponse({ id: "thr_review" });
          },
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "codex",
              displayName: "Codex",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
          ],
          models: async () => ({ models: [], selectedOnlyModels: [] }),
        },
      },
    });
    await plugin(host.bb);
    const result = await host.harness.callRpc("requestReview", {
      threadId: "thr_1",
    });
    expect(result).toEqual({ ok: false, error: "provider_unavailable" });
    expect(spawnCalled).toBe(false);
    await host.harness.dispose();
  });

  it("refuses to review a thread that is itself a spawned cross-model review", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              projectId: "proj_1",
              environmentId: "env_1",
              providerId: "claude-code",
              title: "Fix the bug",
            }),
          spawn: async () => makeThreadResponse({ id: "thr_review" }),
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "codex",
              displayName: "Codex",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
          ],
          models: async () => ({
            models: [{ model: "gpt-5", displayName: "GPT-5", isDefault: true }],
            selectedOnlyModels: [],
          }),
        },
      },
    });
    await plugin(host.bb);
    const first = await host.harness.callRpc("requestReview", {
      threadId: "thr_1",
    });
    expect(first).toMatchObject({ ok: true, reviewThreadId: "thr_review" });
    const second = await host.harness.callRpc("requestReview", {
      threadId: "thr_review",
    });
    expect(second).toEqual({ ok: false, error: "review_of_review" });
    await host.harness.dispose();
  });
});

describe("workbench CLI", () => {
  it("registers routing and multimodel, with no dispatch-mismatched routing-set entry", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    expect(cli.commands.map((command) => command.name)).toEqual([
      "routing",
      "multimodel",
      "review",
      "subagents",
      "outputs",
    ]);
    await host.harness.dispose();
  });

  it("routing lists all five roles with ROUTING.md, frontmatter, and drift", async () => {
    const frontmatter: Record<
      string,
      { model: string; effort: string | null }
    > = {
      implementer: { model: "claude-opus-5", effort: "high" },
      scout: { model: "claude-haiku-4-5", effort: null },
      reviewer: { model: "claude-opus-5", effort: null },
    };
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
        providers: ROUTING_PROVIDERS_SDK,
      },
      experimental_callHostRpc: ({ method, input }) => {
        if (method === "readRouting") {
          return { ok: true, markdown: ROUTING_FIXTURE };
        }
        if (method === "readAgentModel") {
          const role = (input as { role: string }).role;
          return { ok: true, ...frontmatter[role]! };
        }
        throw new Error(`unexpected host RPC method ${method}`);
      },
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    await expect(cli.run(["routing"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: [
        "source: ~/.claude/ROUTING.md",
        "architect: claude-code / claude-fable-5-1 · high (orchestrator thread, read-only)",
        "implementer: claude-opus-5 · effort high | ROUTING.md: claude-code / claude-opus-5[1m] (subagent: claude-opus-5) · high",
        "scout: claude-haiku-4-5 | ROUTING.md: claude-code / claude-sonnet-5 · medium | not allowed by ROUTING.md | differs from ROUTING.md (claude-sonnet-5)",
        "reviewer: claude-opus-5 | ROUTING.md: claude-code / claude-fable-5-1 · high | differs from ROUTING.md (claude-fable-5-1)",
        "cross-vendor reviewer: codex / gpt-5.6-sol · high (source: routing-cross-vendor) | setting: auto",
      ].join("\n"),
    });
    await host.harness.dispose();
  });

  it("routing set rejects haiku for every role and sonnet outside scout", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
      },
      experimental_callHostRpc: ({ method, input }) => {
        if (method === "writeAgentModel") {
          return {
            ok: true,
            model: (input as { model: string }).model,
            effort: null,
          };
        }
        throw new Error(`unexpected host RPC method ${method}`);
      },
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    const haiku = await cli.run(
      ["routing", "set", "scout", "claude-haiku-4-5"],
      {},
    );
    expect(haiku.exitCode).toBe(1);
    expect(haiku.stderr).toContain("not allowed for scout by ROUTING.md");
    const sonnet = await cli.run(
      ["routing", "set", "implementer", "claude-sonnet-5"],
      {},
    );
    expect(sonnet.exitCode).toBe(1);
    expect(sonnet.stderr).toContain("Sonnet only for scout");
    await expect(
      cli.run(["routing", "set", "scout", "claude-sonnet-5"], {}),
    ).resolves.toEqual({ exitCode: 0, stdout: "scout: claude-sonnet-5" });
    expect(
      host.harness.experimental_hostRpcCalls.map((call) => call.input),
    ).toEqual([{ role: "scout", model: "claude-sonnet-5" }]);
    await host.harness.dispose();
  });

  it("routing effort writes a supported level and rejects others", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
      },
      experimental_callHostRpc: ({ method, input }) => {
        if (method === "writeAgentEffort") {
          return {
            ok: true,
            model: "claude-opus-5",
            effort: (input as { effort: string }).effort,
          };
        }
        throw new Error(`unexpected host RPC method ${method}`);
      },
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    await expect(
      cli.run(["routing", "effort", "implementer", "high"], {}),
    ).resolves.toEqual({ exitCode: 0, stdout: "implementer: effort high" });
    const invalid = await cli.run(
      ["routing", "effort", "implementer", "extreme"],
      {},
    );
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain("Invalid effort");
    await host.harness.dispose();
  });

  it("routing set writes through the host under the same name argv[0] resolves to", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
      },
      experimental_callHostRpc: ({ method, input }) => {
        if (method === "writeAgentModel") {
          return {
            ok: true,
            model: (input as { model: string }).model,
            effort: null,
          };
        }
        throw new Error(`unexpected host RPC method ${method}`);
      },
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    await expect(
      cli.run(["routing", "set", "scout", "opus"], {}),
    ).resolves.toEqual({ exitCode: 0, stdout: "scout: opus" });
    await host.harness.dispose();
  });

  it("rejects an unknown role", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    const result = await cli.run(["routing", "set", "bogus", "opus"], {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown role");
    await host.harness.dispose();
  });

  it("rejects a model that would break out of the frontmatter line", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    const result = await cli.run(
      ["routing", "set", "scout", "opus\n---\nevil: 1"],
      {},
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid model");
    await host.harness.dispose();
  });

  it("shows and sets multi-model mode", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        plugins: {
          updateSettings: async ({ values }) => {
            await host.harness.setSettings(values as Record<string, boolean>);
            return {} as never;
          },
        },
      },
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    await expect(cli.run(["multimodel"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: "off",
    });
    await expect(cli.run(["multimodel", "on"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: "on",
    });
    await expect(cli.run(["multimodel"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: "on",
    });
    await host.harness.dispose();
  });

  it("review spawns a review thread and prints its id and provider", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              projectId: "proj_1",
              environmentId: "env_1",
              providerId: "claude-code",
              title: "Fix the bug",
            }),
          spawn: async () => makeThreadResponse({ id: "thr_review" }),
        },
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          list: async () => [
            {
              id: "claude-code",
              displayName: "Claude Code",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
            {
              id: "codex",
              displayName: "Codex",
              available: true,
              capabilities: PERMISSIVE_CAPABILITIES,
            },
          ],
          models: async () => ({
            models: [{ model: "gpt-5", displayName: "GPT-5", isDefault: true }],
            selectedOnlyModels: [],
          }),
        },
      },
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    await expect(cli.run(["review", "thr_1"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: "Started review thread thr_review with Codex (gpt-5) [fallback]",
    });
    await host.harness.dispose();
  });

  it("review requires a threadId argument", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    const result = await cli.run(["review"], {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: bb workbench review");
    await host.harness.dispose();
  });

  it("review reports the resolution error", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({ id: "thr_1", environmentId: "env_1" }),
        },
      },
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    const result = await cli.run(["review", "thr_1"], {});
    expect(result).toEqual({ exitCode: 1, stderr: "host_unavailable" });
    await host.harness.dispose();
  });

  it("rejects an unknown top-level command", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    const result = await cli.run(["bogus"], {});
    expect(result.exitCode).toBe(1);
    await host.harness.dispose();
  });

  it("subagents prints status, title, id, and updatedAt for each child thread", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          list: async () => [
            {
              id: "thr_a",
              title: "Investigate flaky test",
              titleFallback: null,
              updatedAt: 1000,
              runtime: { displayStatus: "active" },
            },
          ],
        },
      },
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    await expect(cli.run(["subagents", "thr_parent"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: `active\tInvestigate flaky test\tthr_a\t${new Date(1000).toISOString()}`,
    });
    await host.harness.dispose();
  });

  it("subagents requires a threadId argument", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    const result = await cli.run(["subagents"], {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: bb workbench subagents");
    await host.harness.dispose();
  });

  it("outputs prints created file paths", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: {
          get: async () => ({ environmentId: "env_1" }),
          timeline: async () => ({
            rows: [
              {
                kind: "work",
                workKind: "file-change",
                change: { path: "src/a.ts", kind: "add" },
              },
            ],
            timelinePage: { hasOlderRows: false, olderCursor: null },
          }),
        },
      },
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    await expect(cli.run(["outputs", "thr_1"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: "src/a.ts",
    });
    await host.harness.dispose();
  });

  it("outputs requires a threadId argument", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    const result = await cli.run(["outputs"], {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage: bb workbench outputs");
    await host.harness.dispose();
  });
});

describe("workbench review target from ROUTING.md", () => {
  it("spawns the cross-vendor reviewer with its model and reasoning level when codex is available", async () => {
    let spawnArgs: unknown;
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: reviewThreadSdk((args) => {
          spawnArgs = args;
        }),
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: ROUTING_PROVIDERS_SDK,
      },
      experimental_callHostRpc: routingHostRpc,
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("requestReview", { threadId: "thr_1" }),
    ).resolves.toEqual({
      ok: true,
      reviewThreadId: "thr_review",
      providerId: "codex",
      providerName: "Codex",
      model: "gpt-5.6-sol",
      effort: "high",
      reasoningLevel: "high",
      source: "routing-cross-vendor",
    });
    expect(spawnArgs).toMatchObject({
      parentThreadId: "thr_1",
      providerId: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
      permissionMode: "accept-edits",
    });
    await host.harness.dispose();
  });

  it("falls back to the in-thread reviewer row when codex is unavailable", async () => {
    let spawnArgs: unknown;
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: reviewThreadSdk((args) => {
          spawnArgs = args;
        }),
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: routingProvidersSdk(["claude-code", "pi"]),
      },
      experimental_callHostRpc: routingHostRpc,
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("requestReview", { threadId: "thr_1" }),
    ).resolves.toMatchObject({
      ok: true,
      providerId: "claude-code",
      model: "claude-fable-5-1",
      source: "routing-subagent",
    });
    expect(spawnArgs).toMatchObject({
      providerId: "claude-code",
      model: "claude-fable-5-1",
      reasoningLevel: "high",
    });
    await host.harness.dispose();
  });

  it("omits the reasoning level when the model does not support the routed effort", async () => {
    let spawnArgs: Record<string, unknown> = {};
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: reviewThreadSdk((args) => {
          spawnArgs = args as Record<string, unknown>;
        }),
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: {
          ...ROUTING_PROVIDERS_SDK,
          models: async (args?: { providerId?: string }) => ({
            models:
              args?.providerId === "codex"
                ? [catalogModel("gpt-5.6-sol", { efforts: ["low"] })]
                : [],
            selectedOnlyModels: [],
          }),
        },
      },
      experimental_callHostRpc: routingHostRpc,
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("requestReview", { threadId: "thr_1" }),
    ).resolves.toMatchObject({
      ok: true,
      model: "gpt-5.6-sol",
      effort: "high",
      reasoningLevel: null,
    });
    expect(spawnArgs).not.toHaveProperty("reasoningLevel");
    await host.harness.dispose();
  });

  it("honors a per-request provider override with that provider's ROUTING.md model", async () => {
    let spawnArgs: unknown;
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: reviewThreadSdk((args) => {
          spawnArgs = args;
        }),
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: ROUTING_PROVIDERS_SDK,
      },
      experimental_callHostRpc: routingHostRpc,
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("requestReview", {
        threadId: "thr_1",
        providerId: "claude-code",
      }),
    ).resolves.toMatchObject({
      ok: true,
      providerId: "claude-code",
      model: "claude-fable-5-1",
      source: "routing-subagent",
    });
    expect(spawnArgs).toMatchObject({
      providerId: "claude-code",
      model: "claude-fable-5-1",
    });
    await expect(
      host.harness.callRpc("requestReview", {
        threadId: "thr_1",
        providerId: "pi",
      }),
    ).resolves.toEqual({ ok: false, error: "provider_unavailable" });
    await host.harness.dispose();
  });

  it("previews the default target and one option per available provider", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: reviewThreadSdk(() => undefined),
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: ROUTING_PROVIDERS_SDK,
      },
      experimental_callHostRpc: routingHostRpc,
    });
    await plugin(host.bb);
    const preview = (await host.harness.callRpc("reviewProviderPreview", {
      threadId: "thr_1",
    })) as {
      target: { ok: boolean; providerId?: string; model?: string };
      options: { providerId: string; model: string; source: string }[];
    };
    expect(preview.target).toMatchObject({
      ok: true,
      providerId: "codex",
      model: "gpt-5.6-sol",
    });
    expect(
      preview.options.map((option) => [option.providerId, option.model]),
    ).toEqual([
      ["claude-code", "claude-fable-5-1"],
      ["codex", "gpt-5.6-sol"],
    ]);
    await host.harness.dispose();
  });

  it("review --provider passes the override and rejects a malformed flag", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: reviewThreadSdk(() => undefined),
        environments: { get: async () => ({ hostId: "host_1" }) },
        providers: ROUTING_PROVIDERS_SDK,
      },
      experimental_callHostRpc: routingHostRpc,
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    await expect(
      cli.run(["review", "thr_1", "--provider", "claude-code"], {}),
    ).resolves.toEqual({
      exitCode: 0,
      stdout:
        "Started review thread thr_review with Claude Code (claude-fable-5-1, high) [routing-subagent]",
    });
    const missing = await cli.run(["review", "thr_1", "--provider"], {});
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("[--provider <id>]");
    await host.harness.dispose();
  });

  it("getRouting returns the parsed ROUTING.md rows and the effective review target", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
        providers: ROUTING_PROVIDERS_SDK,
      },
      experimental_callHostRpc: routingHostRpc,
    });
    await plugin(host.bb);
    const result = (await host.harness.callRpc("getRouting", {
      providerId: null,
    })) as {
      routing: { ok: boolean; entries?: { role: string }[] };
      reviewTarget: unknown;
      reviewProvider: string;
    };
    expect(result.routing.entries?.map((entry) => entry.role)).toEqual([
      "architect",
      "implementer",
      "scout",
      "reviewer-cross-vendor",
      "reviewer-subagent",
    ]);
    expect(result.reviewProvider).toBe("auto");
    expect(result.reviewTarget).toMatchObject({
      ok: true,
      providerId: "codex",
      model: "gpt-5.6-sol",
      source: "routing-cross-vendor",
    });
    await host.harness.dispose();
  });

  it("getRouting reports a missing ROUTING.md and a thread-dependent review target instead of guessing", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
        providers: ROUTING_PROVIDERS_SDK,
      },
      experimental_callHostRpc: ({ method }) => {
        if (method === "readRouting") {
          return { ok: false, error: "missing_file" };
        }
        return routingHostRpc({ method });
      },
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("getRouting", { providerId: null }),
    ).resolves.toMatchObject({
      routing: { ok: false, error: "missing_file" },
      reviewTarget: { ok: false, error: "thread_dependent" },
    });
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    const result = await cli.run(["routing"], {});
    expect(result.stdout).toContain(
      "cross-vendor reviewer: no ROUTING.md reviewer available — the button uses the first provider other than the thread's own | setting: auto",
    );
    await host.harness.dispose();
  });

  it("getRouting still names an explicitly configured provider without a thread", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
        providers: ROUTING_PROVIDERS_SDK,
      },
      experimental_callHostRpc: ({ method }) => {
        if (method === "readRouting") {
          return { ok: false, error: "missing_file" };
        }
        return routingHostRpc({ method });
      },
    });
    await plugin(host.bb);
    await host.harness.setSettings({ reviewProvider: "codex" });
    await expect(
      host.harness.callRpc("getRouting", { providerId: null }),
    ).resolves.toMatchObject({
      reviewTarget: {
        ok: true,
        providerId: "codex",
        model: "gpt-5",
        source: "provider-default",
      },
    });
    await host.harness.dispose();
  });

  it("setRouting refuses a model ROUTING.md disallows for the role without touching the host", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
      },
      experimental_callHostRpc: routingHostRpc,
    });
    await plugin(host.bb);
    await expect(
      host.harness.callRpc("setRouting", {
        role: "reviewer",
        model: "claude-sonnet-5",
      }),
    ).resolves.toEqual({ ok: false, error: "not_allowed" });
    expect(host.harness.experimental_hostRpcCalls).toEqual([]);
    await host.harness.dispose();
  });
});

describe("workbench subagents realtime signal", () => {
  it("publishes the parent thread id when a child thread changes lifecycle state", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.created", {
      thread: makeThreadResponse({
        id: "thr_child",
        parentThreadId: "thr_parent",
      }),
    });
    expect(host.harness.realtimeSignals).toEqual([
      {
        channel: WORKBENCH_SUBAGENTS_REALTIME_CHANNEL,
        payload: { parentThreadId: "thr_parent" },
      },
    ]);
    await host.harness.dispose();
  });

  it("does not publish for a top-level thread's created/active/failed events", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.created", {
      thread: makeThreadResponse({ id: "thr_top", parentThreadId: null }),
    });
    await host.harness.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({ id: "thr_top", parentThreadId: null }),
    });
    await host.harness.emitThreadEvent("thread.failed", {
      thread: makeThreadResponse({ id: "thr_top", parentThreadId: null }),
      error: null,
    });
    expect(host.harness.realtimeSignals).toEqual([]);
    await host.harness.dispose();
  });

  it("publishes its own id when a top-level thread goes idle, to refresh its Outputs", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    await host.harness.emitThreadEvent("thread.idle", {
      thread: makeThreadResponse({ id: "thr_top", parentThreadId: null }),
      lastAssistantText: null,
    });
    expect(host.harness.realtimeSignals).toEqual([
      {
        channel: WORKBENCH_SUBAGENTS_REALTIME_CHANNEL,
        payload: { parentThreadId: "thr_top" },
      },
    ]);
    await host.harness.dispose();
  });
});
