import { describe, expect, it, vi } from "vitest";
import type { DesktopEnvironment } from "../src/environments.js";
import {
  buildTunnelArgs,
  SshTunnelManager,
  type SshChildProcess,
  type SshTunnelDeps,
} from "../src/ssh-tunnel.js";

function makeEnvironment(
  overrides: Partial<NonNullable<DesktopEnvironment["ssh"]>> = {},
): DesktopEnvironment {
  return {
    id: "vps",
    name: "VPS",
    color: "green",
    kind: "ssh",
    syncRules: true,
    actions: [],
    ssh: {
      destination: "artem@host",
      identityFile: "~/.ssh/id_test",
      remotePort: 38886,
      localPort: 38901,
      startCommand: "systemctl --user start bb.service",
      updateCommand: null,
      ...overrides,
    },
  };
}

class FakeChild implements SshChildProcess {
  exitCode: number | null = null;
  private exitListeners: Array<(code: number | null) => void> = [];
  private stderrListeners: Array<(chunk: string) => void> = [];
  kill = vi.fn(() => {
    this.exit(null);
    return true;
  });
  onExit(listener: (code: number | null) => void) {
    this.exitListeners.push(listener);
  }
  onStderr(listener: (chunk: string) => void) {
    this.stderrListeners.push(listener);
  }
  writeStderr(chunk: string) {
    for (const listener of this.stderrListeners) listener(chunk);
  }
  exit(code: number | null) {
    this.exitCode = code ?? 255;
    for (const listener of this.exitListeners) listener(code);
  }
}

function makeDeps(overrides: Partial<SshTunnelDeps> = {}) {
  let clock = 0;
  const children: FakeChild[] = [];
  const deps: SshTunnelDeps = {
    spawn: vi.fn(() => {
      const child = new FakeChild();
      children.push(child);
      return child;
    }),
    probe: vi.fn(async () => false),
    runRemote: vi.fn(async () => ({ exitCode: 0, output: "" })),
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    now: () => clock,
    log: vi.fn(),
    sshCommand: "ssh",
    homeDir: "/home/me",
    ...overrides,
  };
  return { deps, children };
}

describe("buildTunnelArgs", () => {
  it("forwards loopback to loopback and fails fast on a busy local port", () => {
    expect(buildTunnelArgs(makeEnvironment().ssh!, "/home/me")).toEqual([
      "-N",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-i",
      "/home/me/.ssh/id_test",
      "-o",
      "IdentitiesOnly=yes",
      "-L",
      "127.0.0.1:38901:127.0.0.1:38886",
      "artem@host",
    ]);
  });
});

describe("SshTunnelManager", () => {
  it("attaches to a server that already answers without spawning ssh", async () => {
    const { deps } = makeDeps({ probe: vi.fn(async () => true) });
    const manager = new SshTunnelManager(deps);

    await expect(manager.ensure(makeEnvironment())).resolves.toEqual({
      ok: true,
      serverUrl: "http://127.0.0.1:38901",
      startedServer: false,
    });
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it("spawns the tunnel and waits until bb answers through it", async () => {
    let probes = 0;
    const { deps } = makeDeps({
      probe: vi.fn(async () => {
        probes += 1;
        return probes >= 3;
      }),
    });
    const manager = new SshTunnelManager(deps);

    const result = await manager.ensure(makeEnvironment());

    expect(result).toEqual({
      ok: true,
      serverUrl: "http://127.0.0.1:38901",
      startedServer: false,
    });
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.runRemote).not.toHaveBeenCalled();
    manager.stopAll();
  });

  it("reports the ssh error when the tunnel dies before it is ready", async () => {
    const { deps, children } = makeDeps({
      sleep: vi.fn(async () => {
        const child = children[0];
        if (child && child.exitCode === null) {
          child.writeStderr("Permission denied (publickey).\n");
          child.exit(255);
        }
      }),
    });
    const manager = new SshTunnelManager(deps);

    const result = await manager.ensure(makeEnvironment());

    expect(result).toEqual({
      ok: false,
      reason: "ssh to artem@host failed: Permission denied (publickey).",
    });
    manager.stopAll();
  });

  it("starts bb remotely when the tunnel is up but nothing answers", async () => {
    let started = false;
    const { deps } = makeDeps({
      probe: vi.fn(async () => started),
      runRemote: vi.fn(async () => {
        started = true;
        return { exitCode: 0, output: "" };
      }),
    });
    const manager = new SshTunnelManager(deps);

    const result = await manager.ensure(makeEnvironment());

    expect(result).toEqual({
      ok: true,
      serverUrl: "http://127.0.0.1:38901",
      startedServer: true,
    });
    expect(deps.runRemote).toHaveBeenCalledWith("ssh", [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-i",
      "/home/me/.ssh/id_test",
      "-o",
      "IdentitiesOnly=yes",
      "artem@host",
      "systemctl --user start bb.service",
    ]);
    manager.stopAll();
  });

  it("does not run a start command when none is configured", async () => {
    const { deps } = makeDeps();
    const manager = new SshTunnelManager(deps);

    const result = await manager.ensure(
      makeEnvironment({ startCommand: null }),
    );

    expect(result.ok).toBe(false);
    expect(deps.runRemote).not.toHaveBeenCalled();
    manager.stopAll();
  });

  it("shares one in-flight ensure per environment", async () => {
    const { deps } = makeDeps({ probe: vi.fn(async () => true) });
    const manager = new SshTunnelManager(deps);
    const environment = makeEnvironment();

    const [first, second] = await Promise.all([
      manager.ensure(environment),
      manager.ensure(environment),
    ]);

    expect(first).toBe(second);
    expect(deps.probe).toHaveBeenCalledTimes(1);
  });

  it("respawns a wanted tunnel after it drops and stops for good on stop()", async () => {
    vi.useFakeTimers();
    try {
      let probes = 0;
      const { deps, children } = makeDeps({
        probe: vi.fn(async () => {
          probes += 1;
          return probes >= 2;
        }),
      });
      const manager = new SshTunnelManager(deps);
      await manager.ensure(makeEnvironment());
      expect(children).toHaveLength(1);

      children[0]!.exit(255);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(children).toHaveLength(2);

      manager.stop("vps");
      expect(children[1]!.kill).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(children).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
