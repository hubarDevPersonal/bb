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
    const result = await host.harness.callRpc("getRouting");
    expect(result).toMatchObject({
      hostId: "host_1",
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
    const result = await host.harness.callRpc("getRouting");
    expect(result).toMatchObject({
      hostId: null,
      providerId: null,
      providerName: null,
      models: [],
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
