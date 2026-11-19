import { describe, expect, it } from "vitest";
import {
  remoteEntryName,
  transferPathToEnvironment,
  type EnvironmentFileTransferDeps,
  type TransferCommandResult,
  type TransferPathInfo,
} from "../src/environment-file-transfer.js";
import type { DesktopEnvironment } from "../src/environments.js";

const vps: DesktopEnvironment = {
  id: "vps",
  name: "VPS",
  color: "green",
  kind: "ssh",
  syncRules: true,
  actions: [],
  ssh: {
    destination: "artem@host",
    identityFile: "~/.ssh/id test",
    port: 2222,
    remotePort: 38886,
    localPort: 38901,
    startCommand: null,
    updateCommand: null,
  },
};

const mac: DesktopEnvironment = {
  id: "mac",
  name: "This Mac",
  color: "blue",
  kind: "local",
  syncRules: true,
  actions: [],
  ssh: null,
};

const ok = (stdout = ""): TransferCommandResult => ({
  kind: "exited",
  exitCode: 0,
  stdout,
  stderr: "",
});

interface Call {
  command: string;
  args: readonly string[];
  timeoutMs: number | null;
}

function harness(options: {
  info?: TransferPathInfo;
  results?: TransferCommandResult[];
}) {
  const calls: Call[] = [];
  const results = [...(options.results ?? [])];
  const deps: EnvironmentFileTransferDeps = {
    async run(command, args, { timeoutMs }) {
      calls.push({ command, args, timeoutMs });
      return results.shift() ?? ok();
    },
    async inspect(path) {
      if (options.info === undefined) {
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
      }
      return options.info;
    },
    now: () => new Date(2026, 10, 8, 12, 15, 3),
    randomSuffix: () => "ab12",
    homeDir: "/Users/me",
    sshCommand: "/usr/bin/ssh",
    scpCommand: "/usr/bin/scp",
    rsyncCommand: "rsync",
    log: () => {},
  };
  return { deps, calls };
}

const folder: TransferPathInfo = {
  realPath: "/Users/me/Projects/my site",
  isDirectory: true,
  isFile: false,
  sizeBytes: 96,
};

const bigFile: TransferPathInfo = {
  realPath: "/Users/me/Downloads/dump.sql",
  isDirectory: false,
  isFile: true,
  sizeBytes: 50_000_000,
};

const connection = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=10",
  "-p",
  "2222",
  "-i",
  "/Users/me/.ssh/id test",
  "-o",
  "IdentitiesOnly=yes",
];

describe("transferPathToEnvironment", () => {
  it("copies a folder with rsync into a stamped drop directory under the remote home", async () => {
    const { deps, calls } = harness({
      info: folder,
      results: [ok("/home/artem\n"), ok()],
    });

    const result = await transferPathToEnvironment(
      vps,
      { path: "/Users/me/Projects/my site", maxUploadBytes: 100 },
      deps,
    );

    expect(result).toEqual({
      kind: "copied",
      remotePath: "/home/artem/bb-drops/20261108-121503-ab12/my-site",
      isDirectory: true,
      sizeBytes: null,
    });
    expect(calls).toEqual([
      {
        command: "/usr/bin/ssh",
        args: [
          ...connection,
          "artem@host",
          'mkdir -p "$HOME/bb-drops/20261108-121503-ab12" && printf %s "$HOME"',
        ],
        timeoutMs: 30_000,
      },
      {
        command: "rsync",
        args: [
          "-a",
          "-e",
          "/usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=10 -p 2222 -i '/Users/me/.ssh/id test' -o IdentitiesOnly=yes",
          "/Users/me/Projects/my site/",
          "artem@host:/home/artem/bb-drops/20261108-121503-ab12/my-site/",
        ],
        timeoutMs: null,
      },
    ]);
  });

  it("copies a file over the upload limit to a path that keeps its name", async () => {
    const { deps, calls } = harness({
      info: bigFile,
      results: [ok("/home/artem"), ok()],
    });

    const result = await transferPathToEnvironment(
      vps,
      { path: "/Users/me/Downloads/dump.sql", maxUploadBytes: 100 },
      deps,
    );

    expect(result).toEqual({
      kind: "copied",
      remotePath: "/home/artem/bb-drops/20261108-121503-ab12/dump.sql",
      isDirectory: false,
      sizeBytes: 50_000_000,
    });
    expect(calls[1]?.args.slice(-2)).toEqual([
      "/Users/me/Downloads/dump.sql",
      "artem@host:/home/artem/bb-drops/20261108-121503-ab12/dump.sql",
    ]);
  });

  it("leaves files within the upload limit and non-ssh environments to the normal upload", async () => {
    const small = harness({ info: { ...bigFile, sizeBytes: 100 } });
    expect(
      await transferPathToEnvironment(
        vps,
        { path: "/Users/me/a.txt", maxUploadBytes: 100 },
        small.deps,
      ),
    ).toEqual({ kind: "skipped", reason: "within-upload-limit" });
    expect(small.calls).toEqual([]);

    const local = harness({ info: folder });
    for (const environment of [mac, null]) {
      expect(
        await transferPathToEnvironment(
          environment,
          { path: "/Users/me/Projects/my site", maxUploadBytes: 100 },
          local.deps,
        ),
      ).toEqual({ kind: "skipped", reason: "not-an-ssh-environment" });
    }
    expect(local.calls).toEqual([]);
  });

  it("falls back to scp with -P when rsync is not installed locally", async () => {
    const { deps, calls } = harness({
      info: folder,
      results: [
        ok("/home/artem"),
        { kind: "spawn-failed", code: "ENOENT", message: "spawn rsync ENOENT" },
        ok(),
      ],
    });

    const result = await transferPathToEnvironment(
      vps,
      { path: "/Users/me/Projects/my site", maxUploadBytes: 100 },
      deps,
    );

    expect(result.kind).toBe("copied");
    expect(calls[2]).toEqual({
      command: "/usr/bin/scp",
      args: [
        "-q",
        "-p",
        "-r",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-i",
        "/Users/me/.ssh/id test",
        "-o",
        "IdentitiesOnly=yes",
        "-P",
        "2222",
        "/Users/me/Projects/my site",
        "artem@host:/home/artem/bb-drops/20261108-121503-ab12/my-site",
      ],
      timeoutMs: null,
    });
  });

  it("falls back to scp when the remote has no rsync", async () => {
    const { deps, calls } = harness({
      info: bigFile,
      results: [
        ok("/home/artem"),
        {
          kind: "exited",
          exitCode: 12,
          stdout: "",
          stderr:
            "bash: line 1: rsync: command not found\nrsync: connection unexpectedly closed (0 bytes received so far) [sender]\n",
        },
        ok(),
      ],
    });

    const result = await transferPathToEnvironment(
      vps,
      { path: "/Users/me/Downloads/dump.sql", maxUploadBytes: 100 },
      deps,
    );

    expect(result.kind).toBe("copied");
    expect(calls.map((call) => call.command)).toEqual([
      "/usr/bin/ssh",
      "rsync",
      "/usr/bin/scp",
    ]);
    expect(calls[2]?.args).not.toContain("-r");
  });

  it("reports the stderr tail when the copy fails", async () => {
    const { deps, calls } = harness({
      info: folder,
      results: [
        ok("/home/artem"),
        {
          kind: "exited",
          exitCode: 23,
          stdout: "",
          stderr: "rsync: write failed: No space left on device (28)\n",
        },
      ],
    });

    expect(
      await transferPathToEnvironment(
        vps,
        { path: "/Users/me/Projects/my site", maxUploadBytes: 100 },
        deps,
      ),
    ).toEqual({
      kind: "failed",
      message:
        "Could not copy to artem@host: rsync exited 23: rsync: write failed: No space left on device (28)",
    });
    expect(calls).toHaveLength(2);
  });

  it("stops before copying when ssh cannot prepare the drop directory", async () => {
    const { deps, calls } = harness({
      info: folder,
      results: [
        {
          kind: "exited",
          exitCode: 255,
          stdout: "",
          stderr: "artem@host: Permission denied (publickey).\n",
        },
      ],
    });

    expect(
      await transferPathToEnvironment(
        vps,
        { path: "/Users/me/Projects/my site", maxUploadBytes: 100 },
        deps,
      ),
    ).toEqual({
      kind: "failed",
      message:
        "Could not prepare ~/bb-drops on artem@host: ssh exited 255: artem@host: Permission denied (publickey).",
    });
    expect(calls).toHaveLength(1);
  });

  it("refuses an unreadable path and a remote home that is not absolute", async () => {
    const missing = harness({});
    const unreadable = await transferPathToEnvironment(
      vps,
      { path: "/Users/me/gone", maxUploadBytes: 100 },
      missing.deps,
    );
    expect(unreadable.kind).toBe("failed");
    expect(missing.calls).toEqual([]);

    const banner = harness({
      info: folder,
      results: [ok("Welcome to the VPS\n/home/artem")],
    });
    const result = await transferPathToEnvironment(
      vps,
      { path: "/Users/me/Projects/my site", maxUploadBytes: 100 },
      banner.deps,
    );
    expect(result.kind).toBe("failed");
    expect(banner.calls).toHaveLength(1);
  });
});

describe("remoteEntryName", () => {
  it("keeps safe names and replaces characters that need quoting", () => {
    expect(remoteEntryName("report-v2.final.pdf")).toBe("report-v2.final.pdf");
    expect(remoteEntryName("Screen Shot (1).png")).toBe("Screen-Shot-1-.png");
    expect(remoteEntryName("..")).toBe("item");
    expect(remoteEntryName("отчёт 2026")).toBe("отчёт-2026");
    expect(remoteEntryName("$(rm -rf ~)")).toBe("-rm--rf-");
  });
});
