import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute } from "node:path";
import type {
  BbDesktopEnvironmentTransferRequest,
  BbDesktopEnvironmentTransferResult,
} from "@bb/desktop-contract";
import type {
  DesktopEnvironment,
  EnvironmentSshSettings,
} from "./environments.js";
import { shellQuote } from "./environment-actions.js";
import { buildSshConnectionArgs, resolveSshCommand } from "./ssh-tunnel.js";

const REMOTE_DROP_DIRECTORY = "bb-drops";
const PREPARE_TIMEOUT_MS = 30_000;
const OUTPUT_TAIL_LIMIT = 2_000;
const FAILURE_DETAIL_LIMIT = 600;

export type TransferCommandResult =
  | { kind: "exited"; exitCode: number | null; stdout: string; stderr: string }
  | { kind: "spawn-failed"; code: string | null; message: string };

export interface TransferPathInfo {
  realPath: string;
  isDirectory: boolean;
  isFile: boolean;
  sizeBytes: number;
}

export interface EnvironmentFileTransferDeps {
  run(
    command: string,
    args: readonly string[],
    options: { timeoutMs: number | null },
  ): Promise<TransferCommandResult>;
  inspect(path: string): Promise<TransferPathInfo>;
  now(): Date;
  randomSuffix(): string;
  homeDir: string;
  sshCommand: string;
  scpCommand: string;
  rsyncCommand: string;
  log(message: string): void;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dropStamp(date: Date, suffix: string): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${suffix}`;
}

export function remoteEntryName(name: string): string {
  const sanitized = name.normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, "-");
  return sanitized.length === 0 || /^\.+$/u.test(sanitized)
    ? "item"
    : sanitized;
}

function buildScpConnectionArgs(
  ssh: EnvironmentSshSettings,
  homeDir: string,
): string[] {
  const { port, ...withoutPort } = ssh;
  return [
    ...buildSshConnectionArgs(withoutPort, homeDir),
    ...(port === undefined ? [] : ["-P", String(port)]),
  ];
}

function buildPrepareArgs(
  ssh: EnvironmentSshSettings,
  homeDir: string,
  stamp: string,
): string[] {
  return [
    ...buildSshConnectionArgs(ssh, homeDir),
    ssh.destination,
    `mkdir -p "$HOME/${REMOTE_DROP_DIRECTORY}/${stamp}" && printf %s "$HOME"`,
  ];
}

function buildRsyncArgs(args: {
  ssh: EnvironmentSshSettings;
  homeDir: string;
  sshCommand: string;
  localPath: string;
  remotePath: string;
  isDirectory: boolean;
}): string[] {
  const shell = [
    args.sshCommand,
    ...buildSshConnectionArgs(args.ssh, args.homeDir),
  ]
    .map(shellQuote)
    .join(" ");
  const suffix = args.isDirectory ? "/" : "";
  return [
    "-a",
    "-e",
    shell,
    `${args.localPath}${suffix}`,
    `${args.ssh.destination}:${args.remotePath}${suffix}`,
  ];
}

function buildScpArgs(args: {
  ssh: EnvironmentSshSettings;
  homeDir: string;
  localPath: string;
  remotePath: string;
  isDirectory: boolean;
}): string[] {
  return [
    "-q",
    "-p",
    ...(args.isDirectory ? ["-r"] : []),
    ...buildScpConnectionArgs(args.ssh, args.homeDir),
    args.localPath,
    `${args.ssh.destination}:${args.remotePath}`,
  ];
}

function tail(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit
    ? `…${trimmed.slice(trimmed.length - limit)}`
    : trimmed;
}

function describeCommandFailure(
  tool: string,
  result: TransferCommandResult,
): string {
  if (result.kind === "spawn-failed") {
    return `${tool} could not start: ${result.message}`;
  }
  const detail = tail(result.stderr, FAILURE_DETAIL_LIMIT);
  const status =
    result.exitCode === null ? "was stopped" : `exited ${result.exitCode}`;
  return detail.length > 0
    ? `${tool} ${status}: ${detail}`
    : `${tool} ${status}`;
}

function rsyncUnavailable(result: TransferCommandResult): boolean {
  if (result.kind === "spawn-failed") return result.code === "ENOENT";
  return (
    result.exitCode === 127 ||
    /rsync:\s*(?:command )?not found|command not found:\s*rsync/iu.test(
      result.stderr,
    )
  );
}

function failed(message: string): BbDesktopEnvironmentTransferResult {
  return { kind: "failed", message };
}

export async function transferPathToEnvironment(
  environment: DesktopEnvironment | null,
  request: BbDesktopEnvironmentTransferRequest,
  deps: EnvironmentFileTransferDeps,
): Promise<BbDesktopEnvironmentTransferResult> {
  const ssh = environment?.ssh ?? null;
  if (environment === null || ssh === null) {
    return { kind: "skipped", reason: "not-an-ssh-environment" };
  }
  if (!isAbsolute(request.path)) {
    return { kind: "skipped", reason: "not-a-local-file" };
  }
  let info: TransferPathInfo;
  try {
    info = await deps.inspect(request.path);
  } catch (error) {
    return failed(
      `Could not read ${request.path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!info.isDirectory && !info.isFile) {
    return failed(`${request.path} is not a regular file or folder`);
  }
  if (info.isFile && info.sizeBytes <= request.maxUploadBytes) {
    return { kind: "skipped", reason: "within-upload-limit" };
  }

  const stamp = dropStamp(deps.now(), deps.randomSuffix());
  const prepared = await deps.run(
    deps.sshCommand,
    buildPrepareArgs(ssh, deps.homeDir, stamp),
    { timeoutMs: PREPARE_TIMEOUT_MS },
  );
  if (prepared.kind !== "exited" || prepared.exitCode !== 0) {
    return failed(
      `Could not prepare ~/${REMOTE_DROP_DIRECTORY} on ${ssh.destination}: ${describeCommandFailure("ssh", prepared)}`,
    );
  }
  const remoteHome = prepared.stdout.trim();
  if (!remoteHome.startsWith("/") || remoteHome.includes("\n")) {
    return failed(
      `Could not resolve the home directory on ${ssh.destination} (got "${tail(remoteHome, 200)}")`,
    );
  }

  const remotePath = `${remoteHome.replace(/\/+$/u, "")}/${REMOTE_DROP_DIRECTORY}/${stamp}/${remoteEntryName(basename(request.path))}`;
  const copyTarget = {
    ssh,
    homeDir: deps.homeDir,
    localPath: info.realPath,
    remotePath,
    isDirectory: info.isDirectory,
  };
  let copied = await deps.run(
    deps.rsyncCommand,
    buildRsyncArgs({ ...copyTarget, sshCommand: deps.sshCommand }),
    { timeoutMs: null },
  );
  let tool = "rsync";
  if (rsyncUnavailable(copied)) {
    deps.log(
      `[desktop] ${environment.name}: rsync unavailable (${describeCommandFailure("rsync", copied)}), falling back to scp`,
    );
    tool = "scp";
    copied = await deps.run(deps.scpCommand, buildScpArgs(copyTarget), {
      timeoutMs: null,
    });
  }
  if (copied.kind !== "exited" || copied.exitCode !== 0) {
    return failed(
      `Could not copy to ${ssh.destination}: ${describeCommandFailure(tool, copied)}`,
    );
  }
  deps.log(
    `[desktop] ${environment.name}: copied ${request.path} to ${ssh.destination}:${remotePath} with ${tool}`,
  );
  return {
    kind: "copied",
    remotePath,
    isDirectory: info.isDirectory,
    sizeBytes: info.isFile ? info.sizeBytes : null,
  };
}

function appendTail(current: string, chunk: Buffer): string {
  return (current + chunk.toString("utf8")).slice(-OUTPUT_TAIL_LIMIT);
}

function runCommand(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number | null },
): Promise<TransferCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendTail(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendTail(stderr, chunk);
    });
    const timer =
      options.timeoutMs === null
        ? null
        : setTimeout(() => {
            child.kill("SIGTERM");
          }, options.timeoutMs);
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (timer !== null) clearTimeout(timer);
      resolve({
        kind: "spawn-failed",
        code: error.code ?? null,
        message: error.message,
      });
    });
    child.once("close", (code) => {
      if (timer !== null) clearTimeout(timer);
      resolve({ kind: "exited", exitCode: code, stdout, stderr });
    });
  });
}

async function inspectPath(path: string): Promise<TransferPathInfo> {
  const realPath = await realpath(path);
  const stats = await stat(realPath);
  return {
    realPath,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    sizeBytes: stats.size,
  };
}

function resolveSystemCommand(name: string): string {
  return process.platform !== "win32" && existsSync(`/usr/bin/${name}`)
    ? `/usr/bin/${name}`
    : name;
}

export function createEnvironmentFileTransferDeps(
  log: (message: string) => void,
): EnvironmentFileTransferDeps {
  return {
    run: runCommand,
    inspect: inspectPath,
    now: () => new Date(),
    randomSuffix: () => randomBytes(2).toString("hex"),
    homeDir: homedir(),
    sshCommand: resolveSshCommand(),
    scpCommand: resolveSystemCommand("scp"),
    rsyncCommand: "rsync",
    log,
  };
}
