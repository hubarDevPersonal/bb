import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { unwatchFile, watchFile } from "node:fs";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import type { BbDesktopEnvironment } from "@bb/desktop-contract";
import {
  environmentServerUrl,
  findEnvironmentForServerUrl,
  findLocalEnvironment,
  loadEnvironments,
  resolveEnvironmentsPath,
  writeEnvironmentsTemplate,
  type DesktopEnvironment,
  type DesktopEnvironments,
} from "./environments.js";
import {
  buildTerminalScript,
  planEnvironmentActions,
  type EnvironmentActionPlan,
} from "./environment-actions.js";
import {
  SshTunnelManager,
  type EnsureTunnelResult,
  type SshChildProcess,
} from "./ssh-tunnel.js";
import { probeBbServer } from "./server-probe.js";

const ENVIRONMENTS_WATCH_INTERVAL_MS = 1_500;
const REMOTE_START_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 1_500;

type ServerTarget =
  | { kind: "builtin" }
  | { kind: "connect" }
  | { kind: "custom"; url: string };

export interface EnvironmentControllerDeps {
  userDataPath: string;
  getTarget(): ServerTarget;
  selectBuiltin(): Promise<void>;
  selectServerUrl(url: string): Promise<void>;
  openPath(path: string): Promise<string>;
  showError(title: string, message: string): void;
  onEnvironmentsChanged(): void;
  log(message: string): void;
}

export interface EnvironmentController {
  load(): Promise<void>;
  dispose(): void;
  current(): BbDesktopEnvironment | null;
  environmentForServerUrl(url: string): BbDesktopEnvironment | null;
  list(): readonly DesktopEnvironment[];
  ensureServerUrl(url: string): Promise<EnsureTunnelResult | null>;
  select(environmentId: string): Promise<void>;
  isManagedServerUrl(url: string): boolean;
  buildMenu(options: { accelerators: boolean }): MenuItemConstructorOptions[];
}

function wrapChild(child: ReturnType<typeof spawn>): SshChildProcess {
  return {
    get exitCode() {
      return child.exitCode;
    },
    kill(signal) {
      return child.kill(signal);
    },
    onExit(listener) {
      child.once("exit", (code) => listener(code));
      child.once("error", () => listener(null));
    },
    onStderr(listener) {
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => listener(chunk));
    },
  };
}

function runToCompletion(
  command: string,
  args: readonly string[],
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-4_000);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, REMOTE_START_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ exitCode: null, output: error.message });
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, output });
    });
  });
}

function toBridgeEnvironment(
  environment: DesktopEnvironment,
): BbDesktopEnvironment {
  return {
    id: environment.id,
    name: environment.name,
    color: environment.color,
    kind: environment.kind,
    destination: environment.ssh?.destination ?? null,
  };
}

export function createEnvironmentController(
  deps: EnvironmentControllerDeps,
): EnvironmentController {
  const path = resolveEnvironmentsPath(deps.userDataPath);
  let state: DesktopEnvironments = {
    shared: {
      rulesSource: null,
      rulesTarget: "~/Dev/claude-agent",
      rulesInstall: "sh install-agent.sh",
    },
    environments: [],
  };
  let loadProblem: string | null = null;
  let fileExists = false;
  let watching = false;
  const tunnels = new SshTunnelManager({
    spawn: (command, args) =>
      wrapChild(
        spawn(command, [...args], { stdio: ["ignore", "ignore", "pipe"] }),
      ),
    probe: async (serverUrl) =>
      (await probeBbServer({ serverUrl, timeoutMs: PROBE_TIMEOUT_MS })).kind ===
      "compatible",
    runRemote: runToCompletion,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: deps.log,
  });

  async function reload(): Promise<void> {
    const result = await loadEnvironments(path);
    if (result.kind === "loaded") {
      state = result.value;
      loadProblem = null;
      fileExists = true;
    } else if (result.kind === "missing") {
      state = { ...state, environments: [] };
      loadProblem = null;
      fileExists = false;
    } else {
      loadProblem = result.message;
      fileExists = true;
      deps.log(`[desktop] ${path} is invalid: ${result.message}`);
    }
    deps.onEnvironmentsChanged();
  }

  function currentEnvironment(): DesktopEnvironment | null {
    const target = deps.getTarget();
    if (target.kind === "builtin") {
      return findLocalEnvironment(state.environments);
    }
    if (target.kind === "custom") {
      return findEnvironmentForServerUrl(state.environments, target.url);
    }
    return null;
  }

  async function runAction(
    environment: DesktopEnvironment,
    plan: EnvironmentActionPlan,
  ): Promise<void> {
    const directory = join(deps.userDataPath, "environment-actions");
    const file = join(
      directory,
      `${environment.id}-${plan.id.replace(/[^a-z0-9-]/gu, "-")}.command`,
    );
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(file, buildTerminalScript(environment, plan), "utf8");
      await chmod(file, 0o755);
      const error = await deps.openPath(file);
      if (error.length > 0) {
        deps.showError(`Could not run "${plan.label}"`, error);
      }
    } catch (error) {
      deps.showError(
        `Could not run "${plan.label}"`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function openEnvironmentsFile(): Promise<void> {
    if (!fileExists) {
      try {
        await writeEnvironmentsTemplate(path);
      } catch (error) {
        deps.log(
          `[desktop] could not write ${path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await reload();
    }
    const error = await deps.openPath(path);
    if (error.length > 0) {
      deps.showError("Could not open environments.json", error);
    }
  }

  async function select(environmentId: string): Promise<void> {
    const environment = state.environments.find(
      (candidate) => candidate.id === environmentId,
    );
    if (environment === undefined) return;
    if (environment.kind === "local") {
      tunnels.stopAll();
      await deps.selectBuiltin();
      return;
    }
    const url = environmentServerUrl(environment);
    if (url !== null) {
      await deps.selectServerUrl(url);
    }
  }

  return {
    async load() {
      await reload();
      if (!watching) {
        watching = true;
        watchFile(path, { interval: ENVIRONMENTS_WATCH_INTERVAL_MS }, () => {
          void reload();
        });
      }
    },
    dispose() {
      if (watching) {
        unwatchFile(path);
        watching = false;
      }
      tunnels.stopAll();
    },
    current() {
      const environment = currentEnvironment();
      return environment === null ? null : toBridgeEnvironment(environment);
    },
    list() {
      return state.environments;
    },
    environmentForServerUrl(url) {
      const environment = findEnvironmentForServerUrl(state.environments, url);
      return environment === null ? null : toBridgeEnvironment(environment);
    },
    async ensureServerUrl(url) {
      const environment = findEnvironmentForServerUrl(state.environments, url);
      for (const other of state.environments) {
        if (other.id !== environment?.id) tunnels.stop(other.id);
      }
      if (environment === null) return null;
      return tunnels.ensure(environment);
    },
    select,
    isManagedServerUrl(url) {
      return findEnvironmentForServerUrl(state.environments, url) !== null;
    },
    buildMenu({ accelerators }) {
      const current = currentEnvironment();
      const items: MenuItemConstructorOptions[] = state.environments.map(
        (environment, index) => ({
          type: "radio" as const,
          label:
            environment.kind === "ssh"
              ? `${environment.name}  —  ${environment.ssh?.destination ?? ""}`
              : environment.name,
          checked: current?.id === environment.id,
          ...(accelerators
            ? { accelerator: `CommandOrControl+Control+${index + 1}` }
            : {}),
          click() {
            void select(environment.id);
          },
        }),
      );
      if (loadProblem !== null) {
        items.push({
          enabled: false,
          label: "environments.json has errors — see logs",
        });
      } else if (state.environments.length === 0) {
        items.push({ enabled: false, label: "No environments yet" });
      }
      items.push({ type: "separator" });
      if (current !== null) {
        const plans = planEnvironmentActions(current, state.shared);
        items.push({
          label: `${current.name} Actions`,
          submenu: plans.map((plan) => ({
            label: plan.label,
            click() {
              void runAction(current, plan);
            },
          })),
        });
      }
      items.push({
        label: "Sync Shared Rules to All",
        enabled:
          state.shared.rulesSource !== null && state.environments.length > 0,
        click() {
          for (const environment of state.environments) {
            const plan = planEnvironmentActions(environment, state.shared).find(
              (candidate) => candidate.id === "sync-rules",
            );
            if (plan !== undefined) void runAction(environment, plan);
          }
        },
      });
      items.push({ type: "separator" });
      items.push({
        label: fileExists ? "Edit Environments…" : "Set Up Environments…",
        click() {
          void openEnvironmentsFile();
        },
      });
      return items;
    },
  };
}
