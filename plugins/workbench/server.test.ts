import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server.js";

function threadRecord(environmentId: string | null) {
  return { id: "thr_1", environmentId };
}

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

describe("workbench orchestrated mode instructions", () => {
  it("contributes instructions only while the setting is on", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    const ctx = { threadId: "thr_1", projectId: "proj_1" };
    const provider = host.harness.registrations.instructionProvider;
    if (provider === null) throw new Error("expected an instruction provider");

    expect(provider(ctx)).toBeNull();

    await host.harness.setSettings({ orchestratedMode: true });
    expect(provider(ctx)).toContain(
      "Orchestrated mode: act as the orchestrator",
    );

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
});

describe("workbench goal workflow message", () => {
  it("escapes a single quote in the goal for shell quoting", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: { send: async () => ({ ok: true, delivery: "sent" }) },
      },
    });
    await plugin(host.bb);
    const goal = "fix the user's login bug";
    const result = await host.harness.callRpc("runGoal", {
      threadId: "thr_1",
      goal,
      maxTasks: 4,
    });
    const expectedArgs = JSON.stringify({ goal, maxTasks: 4 });
    const expectedQuoted = `'${expectedArgs.replace(/'/g, "'\\''")}'`;
    expect(result).toEqual({
      message:
        "Run the goal workflow and post its run card: " +
        `bb workflows run --name goal --args ${expectedQuoted}`,
    });
    expect(expectedQuoted).toContain("'\\''");
    const sendCalls = host.harness.sdk.callsTo("threads.send");
    expect(sendCalls[0]![0]).toMatchObject({
      threadId: "thr_1",
      mode: "queue-if-active",
    });
    await host.harness.dispose();
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
        if (method === "readAgentModel") return { ok: true, model: "haiku" };
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
          return { ok: true, model: "opus" };
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
        if (method === "readAgentModel") return { ok: true, model: "opus" };
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
      outputs: [{ path: "src/a.ts", environmentId: "env_1" }],
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

describe("workbench goal workflow shell quoting", () => {
  it("keeps a newline and a command substitution inert inside the single-quoted arg", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        threads: { send: async () => ({ ok: true, delivery: "sent" }) },
      },
    });
    await plugin(host.bb);
    const goal = "first line\nsecond line $(rm -rf /) `whoami`";
    const result = await host.harness.callRpc("runGoal", {
      threadId: "thr_1",
      goal,
      maxTasks: 3,
    });
    const message = (result as { message: string }).message;
    const quotedArg = message.slice(message.indexOf("'"));
    expect(quotedArg.startsWith("'")).toBe(true);
    expect(quotedArg.endsWith("'")).toBe(true);
    const jsonInside = quotedArg.slice(1, -1).replace(/'\\''/g, "'");
    expect(JSON.parse(jsonInside)).toEqual({ goal, maxTasks: 3 });
    await host.harness.dispose();
  });
});

describe("workbench CLI", () => {
  it("registers routing and orchestrated, with no dispatch-mismatched routing-set entry", async () => {
    const host = createFakePluginHost({ pluginId: "workbench" });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    expect(cli.commands.map((command) => command.name)).toEqual([
      "routing",
      "orchestrated",
    ]);
    await host.harness.dispose();
  });

  it("routing lists every role's model", async () => {
    const host = createFakePluginHost({
      pluginId: "workbench",
      sdk: {
        hosts: { list: async () => [{ id: "host_1", status: "connected" }] },
      },
      experimental_callHostRpc: ({ method }) => {
        if (method === "readAgentModel") return { ok: true, model: "haiku" };
        throw new Error(`unexpected host RPC method ${method}`);
      },
    });
    await plugin(host.bb);
    const cli = host.harness.registrations.cli;
    if (cli === null) throw new Error("expected a cli registration");
    await expect(cli.run(["routing"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: "scout: haiku\nimplementer: haiku\nreviewer: haiku",
    });
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
          return { ok: true, model: (input as { model: string }).model };
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

  it("shows and sets orchestrated mode", async () => {
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
    await expect(cli.run(["orchestrated"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: "off",
    });
    await expect(cli.run(["orchestrated", "on"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: "on",
    });
    await expect(cli.run(["orchestrated"], {})).resolves.toEqual({
      exitCode: 0,
      stdout: "on",
    });
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
});
