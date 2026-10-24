import {
  cliCommand,
  defineCli,
  type BbPluginApi,
  type PluginCliResult,
} from "@get-bb/plugin-sdk";
import type { AutopilotRuntime } from "../server.js";

const JSON_OPTION = {
  type: "boolean",
  description: "Emit machine-readable JSON",
} as const;

function out(json: boolean, value: unknown, text: string): PluginCliResult {
  return {
    exitCode: 0,
    stdout: json ? `${JSON.stringify(value, null, 2)}\n` : `${text}\n`,
  };
}

function when(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16);
}

export function registerAutopilotCli(bb: BbPluginApi, runtime: AutopilotRuntime): void {
  const { store } = runtime;
  bb.cli.register(
    defineCli({
      name: "autopilot",
      summary: "Autonomous task runner with a usage budget",
      description:
        "Autopilot starts `auto`-labelled todo tasks, has a worker do them and an independent verifier merge them, and keeps its threads under a share of your five-hour and weekly limits. Over budget, its threads are queued until the window resets and then resume on their own.",
      usageErrorExitCode: 2,
      commands: {
        status: cliCommand({
          summary: "Show tracked tasks, budget and recent events",
          options: { json: JSON_OPTION },
          async run(input) {
            const view = {
              paused: store.paused,
              tracked: store.tracked,
              skipped: store.skipped.length,
              recent: store.events.slice(-15),
            };
            const lines = [
              `autopilot: ${store.paused ? "PAUSED" : "running"}`,
              `tracked (${store.tracked.length}):`,
              ...store.tracked.map(
                (t) =>
                  `  ${t.taskKey}\t${t.kind}/${t.phase}\tattempt ${t.attempts + 1}\t${t.threadId}${t.parkedAt ? "\tparked" : ""}`,
              ),
              "recent:",
              ...store.events
                .slice(-15)
                .map((e) => `  ${when(e.at)}  ${e.kind.padEnd(9)} ${e.taskKey}  ${e.detail}`),
            ];
            return out(input.options.json, view, lines.join("\n"));
          },
        }),
        budget: cliCommand({
          summary: "Check whether autopilot may spend now",
          positionals: [
            { name: "provider", description: "Provider id, e.g. claude-code", required: true },
          ],
          options: { json: JSON_OPTION },
          async run(input) {
            const verdict = await runtime.budgetFor(input.positionals.provider!, null);
            const text =
              verdict.kind === "ok"
                ? `ok — headroom ${Math.round(verdict.headroomPercent)}%`
                : `blocked — ${verdict.reason}`;
            return out(input.options.json, verdict, text);
          },
        }),
        tick: cliCommand({
          summary: "Run one autopilot pass now",
          options: { json: JSON_OPTION },
          async run(input) {
            const notes = await runtime.tick("cli");
            return out(input.options.json, { notes }, notes.join("\n") || "nothing to do");
          },
        }),
        pause: cliCommand({
          summary: "Stop starting and resuming autopilot work",
          options: { json: JSON_OPTION },
          async run(input) {
            await store.setPaused(true);
            return out(input.options.json, { paused: true }, "autopilot paused");
          },
        }),
        resume: cliCommand({
          summary: "Resume autopilot",
          options: { json: JSON_OPTION },
          async run(input) {
            await store.setPaused(false);
            await runtime.recheck();
            const notes = await runtime.tick("resume");
            return out(input.options.json, { paused: false, notes }, ["autopilot resumed", ...notes].join("\n"));
          },
        }),
        unskip: cliCommand({
          summary: "Let autopilot pick a task it gave up on again",
          positionals: [{ name: "task-id", description: "Task id", required: true }],
          options: { json: JSON_OPTION },
          async run(input) {
            await store.unskip(input.positionals["task-id"]!);
            return out(input.options.json, { ok: true }, "ok");
          },
        }),
        setup: cliCommand({
          summary: "Create the worker/verifier presets and the queue label",
          options: {
            json: JSON_OPTION,
            provider: { type: "string", description: "Provider id for the presets" },
            model: { type: "string", description: "Model id for the presets" },
          },
          async run(input) {
            const notes = await runtime.setup({
              provider: input.options.provider,
              model: input.options.model,
            });
            return out(input.options.json, { notes }, notes.join("\n") || "already set up");
          },
        }),
      },
    }),
  );
}
