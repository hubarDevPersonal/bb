import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type {
  DesktopEnvironment,
  EnvironmentSshSettings,
} from "./environments.js";
import { environmentServerUrl } from "./environments.js";

const STDERR_TAIL_LIMIT = 2_000;
const TUNNEL_READY_TIMEOUT_MS = 10_000;
const SERVER_START_TIMEOUT_MS = 25_000;
const PROBE_INTERVAL_MS = 250;
const RESPAWN_BASE_DELAY_MS = 1_000;
const RESPAWN_MAX_DELAY_MS = 30_000;
const STABLE_TUNNEL_MS = 60_000;

export interface SshChildProcess {
  readonly exitCode: number | null;
  kill(signal?: NodeJS.Signals): boolean;
  onExit(listener: (code: number | null) => void): void;
  onStderr(listener: (chunk: string) => void): void;
}

export interface SshTunnelDeps {
  spawn(command: string, args: readonly string[]): SshChildProcess;
  probe(serverUrl: string): Promise<boolean>;
  runRemote(
    command: string,
    args: readonly string[],
  ): Promise<{ exitCode: number | null; output: string }>;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(message: string): void;
  sshCommand?: string;
  homeDir?: string;
}

export type EnsureTunnelResult =
  | { ok: true; serverUrl: string; startedServer: boolean }
  | { ok: false; reason: string };

interface TunnelEntry {
  environment: DesktopEnvironment;
  process: SshChildProcess | null;
  stderr: string;
  startedAt: number;
  failures: number;
  wanted: boolean;
  respawnTimer: NodeJS.Timeout | null;
}

export function resolveSshCommand(): string {
  return process.platform !== "win32" && existsSync("/usr/bin/ssh")
    ? "/usr/bin/ssh"
    : "ssh";
}

export function expandHomePath(path: string, homeDir = homedir()): string {
  if (path === "~") return homeDir;
  return path.startsWith("~/") ? `${homeDir}${path.slice(1)}` : path;
}

export function buildSshConnectionArgs(
  ssh: EnvironmentSshSettings,
  homeDir = homedir(),
  options: { batchMode: boolean } = { batchMode: true },
): string[] {
  return [
    ...(options.batchMode ? ["-o", "BatchMode=yes"] : []),
    "-o",
    "ConnectTimeout=10",
    ...(ssh.port === undefined ? [] : ["-p", String(ssh.port)]),
    ...(ssh.identityFile === undefined
      ? []
      : [
          "-i",
          expandHomePath(ssh.identityFile, homeDir),
          "-o",
          "IdentitiesOnly=yes",
        ]),
  ];
}

export function buildTunnelArgs(
  ssh: EnvironmentSshSettings,
  homeDir = homedir(),
): string[] {
  return [
    "-N",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    ...buildSshConnectionArgs(ssh, homeDir),
    "-L",
    `127.0.0.1:${ssh.localPort}:127.0.0.1:${ssh.remotePort}`,
    ssh.destination,
  ];
}

function appendTail(current: string, chunk: string): string {
  const next = current + chunk;
  return next.length > STDERR_TAIL_LIMIT
    ? next.slice(next.length - STDERR_TAIL_LIMIT)
    : next;
}

export class SshTunnelManager {
  private readonly entries = new Map<string, TunnelEntry>();
  private readonly pending = new Map<string, Promise<EnsureTunnelResult>>();
  private readonly sshCommand: string;
  private readonly homeDir: string;

  constructor(private readonly deps: SshTunnelDeps) {
    this.sshCommand = deps.sshCommand ?? resolveSshCommand();
    this.homeDir = deps.homeDir ?? homedir();
  }

  ensure(environment: DesktopEnvironment): Promise<EnsureTunnelResult> {
    const inFlight = this.pending.get(environment.id);
    if (inFlight !== undefined) return inFlight;
    const promise = this.ensureOnce(environment).finally(() => {
      this.pending.delete(environment.id);
    });
    this.pending.set(environment.id, promise);
    return promise;
  }

  isRunning(environmentId: string): boolean {
    const entry = this.entries.get(environmentId);
    return entry?.process !== null && entry?.process?.exitCode === null;
  }

  stop(environmentId: string): void {
    const entry = this.entries.get(environmentId);
    if (entry === undefined) return;
    entry.wanted = false;
    if (entry.respawnTimer !== null) clearTimeout(entry.respawnTimer);
    entry.respawnTimer = null;
    entry.process?.kill("SIGTERM");
    this.entries.delete(environmentId);
  }

  stopAll(): void {
    for (const environmentId of [...this.entries.keys()]) {
      this.stop(environmentId);
    }
  }

  private async ensureOnce(
    environment: DesktopEnvironment,
  ): Promise<EnsureTunnelResult> {
    const ssh = environment.ssh;
    const serverUrl = environmentServerUrl(environment);
    if (ssh === null || serverUrl === null) {
      return { ok: false, reason: `${environment.name} has no ssh settings` };
    }
    if (await this.deps.probe(serverUrl)) {
      return { ok: true, serverUrl, startedServer: false };
    }

    const entry = this.entryFor(environment);
    entry.wanted = true;
    if (entry.process === null || entry.process.exitCode !== null) {
      this.spawnTunnel(entry);
    }
    if (await this.waitForServer(entry, serverUrl, TUNNEL_READY_TIMEOUT_MS)) {
      return { ok: true, serverUrl, startedServer: false };
    }
    if (entry.process === null || entry.process.exitCode !== null) {
      return {
        ok: false,
        reason: this.describeTunnelFailure(environment, entry),
      };
    }
    if (ssh.startCommand === null) {
      return {
        ok: false,
        reason: `The tunnel to ${ssh.destination} is up, but no bb server answers on remote port ${ssh.remotePort}.`,
      };
    }

    this.deps.log(
      `[desktop] ${environment.name}: bb is not answering, running "${ssh.startCommand}"`,
    );
    const started = await this.deps.runRemote(this.sshCommand, [
      ...buildSshConnectionArgs(ssh, this.homeDir),
      ssh.destination,
      ssh.startCommand,
    ]);
    if (started.exitCode !== 0) {
      return {
        ok: false,
        reason: `Could not start bb on ${ssh.destination} (exit ${started.exitCode ?? "signal"}): ${started.output.trim() || "no output"}`,
      };
    }
    if (await this.waitForServer(entry, serverUrl, SERVER_START_TIMEOUT_MS)) {
      return { ok: true, serverUrl, startedServer: true };
    }
    return {
      ok: false,
      reason: `Started bb on ${ssh.destination}, but it did not answer on remote port ${ssh.remotePort} within ${SERVER_START_TIMEOUT_MS / 1000}s.`,
    };
  }

  private entryFor(environment: DesktopEnvironment): TunnelEntry {
    const existing = this.entries.get(environment.id);
    if (existing !== undefined) {
      existing.environment = environment;
      return existing;
    }
    const entry: TunnelEntry = {
      environment,
      process: null,
      stderr: "",
      startedAt: 0,
      failures: 0,
      wanted: false,
      respawnTimer: null,
    };
    this.entries.set(environment.id, entry);
    return entry;
  }

  private spawnTunnel(entry: TunnelEntry): void {
    const ssh = entry.environment.ssh;
    if (ssh === null) return;
    if (entry.respawnTimer !== null) {
      clearTimeout(entry.respawnTimer);
      entry.respawnTimer = null;
    }
    entry.stderr = "";
    entry.startedAt = this.deps.now();
    const child = this.deps.spawn(
      this.sshCommand,
      buildTunnelArgs(ssh, this.homeDir),
    );
    entry.process = child;
    child.onStderr((chunk) => {
      entry.stderr = appendTail(entry.stderr, chunk);
    });
    child.onExit((code) => {
      if (entry.process !== child) return;
      const ranFor = this.deps.now() - entry.startedAt;
      entry.failures = ranFor >= STABLE_TUNNEL_MS ? 1 : entry.failures + 1;
      this.deps.log(
        `[desktop] ${entry.environment.name}: ssh tunnel exited (${code ?? "signal"})${entry.stderr.trim() ? `: ${entry.stderr.trim()}` : ""}`,
      );
      if (!entry.wanted || this.entries.get(entry.environment.id) !== entry) {
        return;
      }
      const delay = Math.min(
        RESPAWN_BASE_DELAY_MS * 2 ** Math.max(0, entry.failures - 1),
        RESPAWN_MAX_DELAY_MS,
      );
      entry.respawnTimer = setTimeout(() => {
        entry.respawnTimer = null;
        if (entry.wanted && this.entries.get(entry.environment.id) === entry) {
          this.spawnTunnel(entry);
        }
      }, delay);
    });
  }

  private async waitForServer(
    entry: TunnelEntry,
    serverUrl: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = this.deps.now() + timeoutMs;
    while (this.deps.now() < deadline) {
      if (entry.process === null || entry.process.exitCode !== null) {
        return false;
      }
      if (await this.deps.probe(serverUrl)) return true;
      await this.deps.sleep(PROBE_INTERVAL_MS);
    }
    return false;
  }

  private describeTunnelFailure(
    environment: DesktopEnvironment,
    entry: TunnelEntry,
  ): string {
    const destination = environment.ssh?.destination ?? environment.name;
    const detail = entry.stderr.trim();
    return detail.length > 0
      ? `ssh to ${destination} failed: ${detail}`
      : `ssh to ${destination} exited before the tunnel was ready.`;
  }
}
