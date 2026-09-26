import { homedir } from "node:os";
import type {
  DesktopEnvironment,
  EnvironmentSharedSettings,
} from "./environments.js";
import { buildSshConnectionArgs, expandHomePath } from "./ssh-tunnel.js";

const CODEX_LOGIN_CALLBACK_PORT = 1455;

export type EnvironmentActionId =
  | "sync-rules"
  | "update-bb"
  | "login-claude"
  | "login-codex"
  | "open-shell"
  | `custom:${string}`;

export interface EnvironmentActionPlan {
  id: EnvironmentActionId;
  label: string;
  script: string;
}

export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./~-]+$/u.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
}

function joinCommand(parts: readonly string[]): string {
  return parts.map(shellQuote).join(" ");
}

function sshInvocation(
  environment: DesktopEnvironment,
  homeDir: string,
  options: { interactive: boolean; forwards?: readonly string[] },
): string[] {
  const ssh = environment.ssh;
  if (ssh === null) return [];
  const connection = buildSshConnectionArgs(ssh, homeDir, {
    batchMode: !options.interactive,
  });
  return [
    "ssh",
    ...(options.interactive ? ["-t"] : []),
    ...connection,
    ...(options.forwards ?? []).flatMap((forward) => ["-L", forward]),
    ssh.destination,
  ];
}

function remoteCommandScript(
  environment: DesktopEnvironment,
  homeDir: string,
  command: string,
  options: { interactive: boolean; forwards?: readonly string[] } = {
    interactive: false,
  },
): string {
  return `${joinCommand(sshInvocation(environment, homeDir, options))} ${shellQuote(command)}`;
}

function remotePath(path: string): string {
  return path.startsWith("~/") ? path.slice(2) : path;
}

function syncRulesScript(
  environment: DesktopEnvironment,
  shared: EnvironmentSharedSettings,
  homeDir: string,
): string | null {
  if (shared.rulesSource === null || !environment.syncRules) return null;
  const source = expandHomePath(shared.rulesSource, homeDir).replace(
    /\/+$/u,
    "",
  );
  if (environment.ssh === null) {
    return `cd ${shellQuote(source)} && ${shared.rulesInstall}`;
  }
  const ssh = environment.ssh;
  const rsyncShell = joinCommand([
    "ssh",
    ...buildSshConnectionArgs(ssh, homeDir),
  ]);
  const target = remotePath(shared.rulesTarget).replace(/\/+$/u, "");
  return [
    `${joinCommand(["ssh", ...buildSshConnectionArgs(ssh, homeDir), ssh.destination, `mkdir -p ${target}`])}`,
    `rsync -az --exclude .git -e ${shellQuote(rsyncShell)} ${shellQuote(`${source}/`)} ${shellQuote(`${ssh.destination}:${target}/`)}`,
    remoteCommandScript(
      environment,
      homeDir,
      `cd ${target} && ${shared.rulesInstall}`,
    ),
  ].join(" && \\\n  ");
}

export function planEnvironmentActions(
  environment: DesktopEnvironment,
  shared: EnvironmentSharedSettings,
  homeDir = homedir(),
): EnvironmentActionPlan[] {
  const plans: EnvironmentActionPlan[] = [];
  const syncRules = syncRulesScript(environment, shared, homeDir);
  if (syncRules !== null) {
    plans.push({
      id: "sync-rules",
      label: "Sync Shared Rules",
      script: syncRules,
    });
  }
  if (environment.ssh !== null) {
    if (environment.ssh.updateCommand !== null) {
      plans.push({
        id: "update-bb",
        label: "Update bb on Environment",
        script: remoteCommandScript(
          environment,
          homeDir,
          environment.ssh.updateCommand,
        ),
      });
    }
    plans.push(
      {
        id: "login-claude",
        label: "Log In to Claude Code…",
        script: remoteCommandScript(environment, homeDir, "claude /login", {
          interactive: true,
        }),
      },
      {
        id: "login-codex",
        label: "Log In to Codex…",
        script: remoteCommandScript(environment, homeDir, "codex login", {
          interactive: true,
          forwards: [
            `${CODEX_LOGIN_CALLBACK_PORT}:127.0.0.1:${CODEX_LOGIN_CALLBACK_PORT}`,
          ],
        }),
      },
      {
        id: "open-shell",
        label: "Open SSH Shell",
        script: joinCommand(
          sshInvocation(environment, homeDir, { interactive: true }),
        ),
      },
    );
  } else {
    plans.push(
      {
        id: "login-claude",
        label: "Log In to Claude Code…",
        script: "claude /login",
      },
      { id: "login-codex", label: "Log In to Codex…", script: "codex login" },
    );
  }
  for (const action of environment.actions) {
    plans.push({
      id: `custom:${action.id}`,
      label: action.label,
      script: action.command,
    });
  }
  return plans;
}

export function buildTerminalScript(
  environment: DesktopEnvironment,
  plan: EnvironmentActionPlan,
): string {
  const ssh = environment.ssh;
  const exports = [
    `export BB_ENV_ID=${shellQuote(environment.id)}`,
    `export BB_ENV_NAME=${shellQuote(environment.name)}`,
    `export BB_ENV_SSH_DESTINATION=${shellQuote(ssh?.destination ?? "")}`,
  ];
  return [
    "#!/bin/bash",
    'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"',
    ...exports,
    `printf '\\033]0;%s\\007' ${shellQuote(`${environment.name} — ${plan.label}`)}`,
    `echo ${shellQuote(`▶ ${environment.name}: ${plan.label}`)}`,
    `${plan.script}`,
    "status=$?",
    "echo",
    'if [ "$status" -eq 0 ]; then echo "✔ done"; else echo "✖ failed (exit $status)"; fi',
    'read -r -p "Press Return to close…" _',
    'exit "$status"',
    "",
  ].join("\n");
}
