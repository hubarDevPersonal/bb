import { Command } from "commander";
import { isClaudeArtifactUrl } from "@bb/domain";
import type { BbSdk } from "@bb/sdk";
import { action, CliUsageError } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { getErrorMessage } from "./helpers.js";
import {
  resolveContextThreadId,
  resolveExplicitIdFlag,
} from "../context-env.js";

interface ArtifactOpenOptions {
  host?: string;
  instance?: string;
  json?: boolean;
  thread?: string;
}

interface DesktopWindow {
  generation: string;
  hostId: string;
  instanceId: string;
  label: string;
}

interface DesktopWindowListing {
  failures: string[];
  windows: DesktopWindow[];
}

async function listDesktopWindows(
  sdk: BbSdk,
  hostId: string | undefined,
): Promise<DesktopWindowListing> {
  const desktop = sdk.experimental_desktopBrowsers;
  if (hostId !== undefined) {
    return {
      failures: [],
      windows: (await desktop.listInstances({ hostId })).instances,
    };
  }
  const hosts = await sdk.hosts.list();
  const perHost = await Promise.all(
    hosts
      .filter((host) => host.status === "connected")
      .map((host) =>
        desktop.listInstances({ hostId: host.id }).then(
          (result): DesktopWindowListing => ({
            failures: [],
            windows: result.instances,
          }),
          (error: unknown): DesktopWindowListing => ({
            failures: [`${host.id}: ${getErrorMessage(error)}`],
            windows: [],
          }),
        ),
      ),
  );
  return {
    failures: perHost.flatMap((listing) => listing.failures),
    windows: perHost.flatMap((listing) => listing.windows),
  };
}

function formatWindows(windows: readonly DesktopWindow[]): string {
  return windows
    .map((entry) => `  ${entry.hostId}  ${entry.instanceId}  ${entry.label}`)
    .join("\n");
}

async function resolveDesktopWindow(
  sdk: BbSdk,
  options: Pick<ArtifactOpenOptions, "host" | "instance">,
): Promise<DesktopWindow> {
  const hostId = resolveExplicitIdFlag({
    flagName: "--host",
    value: options.host,
  });
  const instanceId = resolveExplicitIdFlag({
    flagName: "--instance",
    value: options.instance,
  });
  const listing = await listDesktopWindows(sdk, hostId);
  const windows = listing.windows.filter(
    (entry) => instanceId === undefined || entry.instanceId === instanceId,
  );
  const [only, ...rest] = windows;
  if (only === undefined) {
    const notFound =
      instanceId === undefined
        ? "No connected bb desktop window found."
        : `No connected bb desktop window matches --instance ${instanceId}.`;
    throw new CliUsageError({
      code: "not_found",
      hint: "Open the bb desktop app, then retry. List windows with `bb browser instances --host <id>`.",
      message:
        listing.failures.length === 0
          ? notFound
          : `${notFound} Some hosts could not be queried:\n${listing.failures.map((failure) => `  ${failure}`).join("\n")}`,
    });
  }
  if (rest.length > 0) {
    throw new CliUsageError({
      code: "ambiguous",
      hint: "Pass --host <id> --instance <id> to choose one.",
      message: `Several bb desktop windows are connected:\n${formatWindows(windows)}`,
    });
  }
  return only;
}

export function registerArtifactCommands(
  program: Command,
  getUrl: () => string,
) {
  const artifact = program
    .command("artifact")
    .description("Open Claude artifacts inside bb");
  artifact
    .command("open <url>")
    .description("Open a claude.ai artifact in a bb desktop browser tab")
    .option(
      "--thread <id>",
      "Thread whose browser tabs receive the artifact; defaults to BB_THREAD_ID",
    )
    .option(
      "--host <id>",
      "Browser host ID; defaults to the host of the only connected desktop window",
    )
    .option(
      "--instance <id>",
      "Desktop window instance ID; needed when several windows are connected",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (url: string, options: ArtifactOpenOptions) => {
        if (!isClaudeArtifactUrl(url)) {
          throw new CliUsageError({
            code: "invalid_value",
            hint: "Pass an https://claude.ai/artifact/<id>, https://claude.ai/code/artifact/<id>, or https://claude.ai/public/artifacts/<id> URL.",
            message: `Not a Claude artifact URL: ${url}`,
          });
        }
        const threadId =
          resolveExplicitIdFlag({
            flagName: "--thread",
            value: options.thread,
          }) ?? resolveContextThreadId();
        if (threadId === undefined) {
          throw new CliUsageError({
            code: "missing_required",
            hint: "Pass --thread <id>, or run inside a bb thread.",
            message: "Missing thread for the artifact tab.",
          });
        }
        const sdk = createCliBbSdk(getUrl());
        const desktopWindow = await resolveDesktopWindow(sdk, options);
        const result = await sdk.experimental_desktopBrowsers.createTab({
          hostId: desktopWindow.hostId,
          instanceId: desktopWindow.instanceId,
          generation: desktopWindow.generation,
          threadId,
          url,
          presentation: "reveal",
        });
        if (options.json) {
          console.log(JSON.stringify(result));
          return;
        }
        console.log(`Opened ${url} in tab ${result.tab.tabId}`);
      }),
    );
}
