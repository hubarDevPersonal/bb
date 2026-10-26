import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWorkbenchHostEntry } from "./host.js";
import {
  collectSecurityContext,
  defaultSecurityContextDeps,
  type SecurityContextDeps,
} from "./security-context.js";

const run = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await run("git", args, { cwd });
}

describe("collectSecurityContext", () => {
  let root: string;
  let repo: string;
  let home: string;
  let deps: SecurityContextDeps;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "wb-security-context-"));
    repo = path.join(root, "repo");
    home = path.join(root, "home");
    await mkdir(path.join(home, ".claude/specs"), { recursive: true });
    await writeFile(
      path.join(home, ".claude/specs/security.md"),
      "SEC-1 secrets stay out\n",
    );
    await mkdir(path.join(repo, ".claude/specs"), { recursive: true });
    await git(repo, "init", "-q", "-b", "main");
    await git(repo, "config", "user.email", "test@example.com");
    await git(repo, "config", "user.name", "Test");
    await writeFile(path.join(repo, "app.ts"), "export const a = 1;\n");
    await writeFile(
      path.join(repo, ".claude/specs/PROJECT.md"),
      "PRJ-C1 no comments\n",
    );
    await git(repo, "add", ".");
    await git(repo, "commit", "-q", "-m", "init");
    await git(repo, "checkout", "-q", "-b", "feature");
    await writeFile(path.join(repo, "app.ts"), "export const a = 2;\n");
    await mkdir(path.join(repo, "deploy"));
    await writeFile(
      path.join(repo, "deploy/server.pem"),
      "PRIVATE-KEY-BYTES\n",
    );
    await git(repo, "add", ".");
    await git(repo, "commit", "-q", "-m", "change");
    await writeFile(path.join(repo, "app.ts"), "export const a = 3;\n");
    await writeFile(path.join(repo, "id_rsa"), "ssh-private-material\n");
    await git(repo, "add", "id_rsa");
    await writeFile(path.join(repo, "new.ts"), "export const b = 1;\n");
    await writeFile(path.join(repo, ".env"), "TOKEN=do-not-send\n");
    await writeFile(path.join(repo, "blob.bin"), Buffer.from([1, 0, 2]));
    await writeFile(path.join(root, "outside.txt"), "outside secret\n");
    await symlink(path.join(root, "outside.txt"), path.join(repo, "link.txt"));
    deps = { ...defaultSecurityContextDeps, homeDir: () => home };
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("diffs the working tree against HEAD and adds untracked text files, skipping secrets, symlinks, and binaries", async () => {
    const result = await collectSecurityContext(
      { cwd: repo, range: null, maxChars: 100_000 },
      deps,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.diff).toContain("+export const a = 3;");
    expect(result.diff).toContain("+++ b/new.ts");
    expect(result.diff).toContain("+export const b = 1;");
    expect(result.diff).not.toContain("do-not-send");
    expect(result.diff).not.toContain("outside secret");
    expect(result.diff).not.toContain("ssh-private-material");
    expect(result.files).toEqual(["app.ts", "new.ts"]);
    expect(result.untracked).toEqual(["new.ts"]);
    expect(result.skipped).toEqual([
      "id_rsa (secret-like name)",
      ".env (secret-like name)",
      "blob.bin (binary)",
      "link.txt (not a regular file)",
    ]);
    expect(result.truncated).toBe(false);
    expect(result.securitySpec).toBe("SEC-1 secrets stay out\n");
    expect(result.projectSpec).toBe("PRJ-C1 no comments\n");
  });

  it("diffs a worktree branch against its base without untracked files", async () => {
    const result = await collectSecurityContext(
      {
        cwd: repo,
        range: { base: "main", branch: "feature" },
        maxChars: 100_000,
      },
      deps,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.diff).toContain("+export const a = 2;");
    expect(result.diff).not.toContain("new.ts");
    expect(result.diff).not.toContain("PRIVATE-KEY-BYTES");
    expect(result.diff).not.toContain("server.pem");
    expect(result.files).toEqual(["app.ts"]);
    expect(result.untracked).toEqual([]);
    expect(result.skipped).toEqual(["deploy/server.pem (secret-like name)"]);
  });

  it("never reads a PROJECT.md that is a symlink or resolves outside the workspace", async () => {
    const outsideSpecs = path.join(root, "outside-claude/specs");
    await mkdir(outsideSpecs, { recursive: true });
    await writeFile(path.join(outsideSpecs, "PROJECT.md"), "outside spec\n");
    const linkedFile = path.join(root, "linked-file");
    const linkedDir = path.join(root, "linked-dir");
    for (const dir of [linkedFile, linkedDir]) {
      await mkdir(dir);
      await git(dir, "init", "-q", "-b", "main");
      await git(dir, "config", "user.email", "test@example.com");
      await git(dir, "config", "user.name", "Test");
      await writeFile(path.join(dir, "a.ts"), "1\n");
      await git(dir, "add", ".");
      await git(dir, "commit", "-q", "-m", "init");
      await writeFile(path.join(dir, "a.ts"), "2\n");
    }
    await mkdir(path.join(linkedFile, ".claude/specs"), { recursive: true });
    await symlink(
      path.join(outsideSpecs, "PROJECT.md"),
      path.join(linkedFile, ".claude/specs/PROJECT.md"),
    );
    await symlink(
      path.join(root, "outside-claude"),
      path.join(linkedDir, ".claude"),
    );
    for (const cwd of [linkedFile, linkedDir]) {
      const result = await collectSecurityContext(
        { cwd, range: null, maxChars: 100_000 },
        deps,
      );
      if (!result.ok) throw new Error(result.error);
      expect(result.projectSpec).toBeNull();
      expect(result.skipped).toContain(
        ".claude/specs/PROJECT.md (not a regular file inside the workspace)",
      );
    }
  });

  it("reads the security spec only when it is a regular file", async () => {
    const otherHome = path.join(root, "home-with-dir");
    await mkdir(path.join(otherHome, ".claude/specs/security.md"), {
      recursive: true,
    });
    const result = await collectSecurityContext(
      { cwd: repo, range: null, maxChars: 100_000 },
      { ...deps, homeDir: () => otherHome },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.securitySpec).toBeNull();
  });

  async function initRepo(dir: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await git(dir, "init", "-q", "-b", "main");
    await git(dir, "config", "user.email", "test@example.com");
    await git(dir, "config", "user.name", "Test");
  }

  it("withholds the deleted lines of a secret-like file renamed to an innocuous name", async () => {
    const renamed = path.join(root, "renamed");
    await initRepo(renamed);
    const lines = Array.from({ length: 12 }, (_, index) => `LINE_${index}`);
    await writeFile(
      path.join(renamed, ".env"),
      [...lines, "ORIGINAL_ENV_LINE_SHOULD_NOT_LEAK"].join("\n") + "\n",
    );
    await git(renamed, "add", ".");
    await git(renamed, "commit", "-q", "-m", "init");
    await git(renamed, "checkout", "-q", "-b", "feature");
    await git(renamed, "mv", ".env", "notes.txt");
    await writeFile(
      path.join(renamed, "notes.txt"),
      [...lines, "replacement"].join("\n") + "\n",
    );
    await git(renamed, "add", "-A");
    const head = await collectSecurityContext(
      { cwd: renamed, range: null, maxChars: 100_000 },
      deps,
    );
    await git(renamed, "commit", "-q", "-m", "rename");
    const branch = await collectSecurityContext(
      {
        cwd: renamed,
        range: { base: "main", branch: "feature" },
        maxChars: 100_000,
      },
      deps,
    );
    for (const result of [head, branch]) {
      if (!result.ok) throw new Error(result.error);
      expect(result.diff).not.toContain("ORIGINAL_ENV_LINE_SHOULD_NOT_LEAK");
      expect(result.diff).toContain("+replacement");
      expect(result.files).toEqual(["notes.txt"]);
      expect(result.skipped).toContain(".env (secret-like name)");
    }
  });

  it("redacts secret values in tracked and untracked content and reports the counts", async () => {
    const leaky = path.join(root, "leaky");
    await initRepo(leaky);
    await writeFile(path.join(leaky, "config.ts"), "export const a = 1;\n");
    await git(leaky, "add", ".");
    await git(leaky, "commit", "-q", "-m", "init");
    await writeFile(
      path.join(leaky, "config.ts"),
      "export const key = 'AKIAABCDEFGHIJKLMNOP';\nexport const DB_PASSWORD = 'hunter2hunter2';\n",
    );
    await writeFile(
      path.join(leaky, "notes.md"),
      "Authorization: Bearer abcdefghijklmnop\n",
    );
    const result = await collectSecurityContext(
      { cwd: leaky, range: null, maxChars: 100_000 },
      deps,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.diff).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(result.diff).not.toContain("hunter2hunter2");
    expect(result.diff).not.toContain("abcdefghijklmnop");
    expect(result.diff).toContain("+export const DB_PASSWORD = '[redacted]';");
    expect(result.skipped).toEqual([
      "2 values redacted in config.ts",
      "1 value redacted in notes.md",
    ]);
  });

  it("reads untracked files through a no-follow handle and rejects anything that is not a regular file", async () => {
    const result = await collectSecurityContext(
      { cwd: repo, range: null, maxChars: 100_000 },
      {
        ...deps,
        openNoFollow: async (filePath) =>
          filePath.endsWith("new.ts")
            ? {
                stat: async () => ({ isFile: () => false, size: 0 }),
                readFile: async () => Buffer.from("never read"),
                close: async () => undefined,
              }
            : defaultSecurityContextDeps.openNoFollow(filePath),
      },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.untracked).toEqual([]);
    expect(result.skipped).toContain("new.ts (not a regular file)");
    expect(result.diff).not.toContain("never read");
  });

  it("truncates the diff to maxChars and flags it", async () => {
    const result = await collectSecurityContext(
      { cwd: repo, range: null, maxChars: 1_000 },
      { ...deps, homeDir: () => path.join(root, "missing-home") },
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.diff.length).toBeLessThanOrEqual(1_000);
    expect(result.securitySpec).toBeNull();
    const small = await collectSecurityContext(
      { cwd: repo, range: null, maxChars: 1_000 },
      {
        ...deps,
        runGit: async (cwd, args, maxChars) =>
          args[0] === "diff" && !args.includes("--name-only")
            ? { stdout: "x".repeat(maxChars), truncated: true }
            : defaultSecurityContextDeps.runGit(cwd, args, maxChars),
      },
    );
    if (!small.ok) throw new Error(small.error);
    expect(small.truncated).toBe(true);
    expect(small.diff).toHaveLength(1_000);
  });

  it("fails closed when the changed or untracked file list is truncated", async () => {
    const diffCalls: string[][] = [];
    for (const truncatedCommand of ["--name-only", "ls-files"]) {
      const result = await collectSecurityContext(
        { cwd: repo, range: null, maxChars: 100_000 },
        {
          ...deps,
          runGit: async (cwd, args, maxChars) => {
            if (args.includes(truncatedCommand)) {
              return { stdout: "app.ts\0.en", truncated: true };
            }
            if (!args.includes("--name-only") && args[0] === "diff") {
              diffCalls.push([...args]);
            }
            return defaultSecurityContextDeps.runGit(cwd, args, maxChars);
          },
        },
      );
      expect(result).toEqual({
        ok: false,
        error: "too many changed files to list safely",
      });
    }
    expect(diffCalls).toHaveLength(1);
  });

  it("reports a git failure for an unknown branch", async () => {
    const result = await collectSecurityContext(
      {
        cwd: repo,
        range: { base: "main", branch: "missing-branch" },
        maxChars: 100_000,
      },
      deps,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects option-like refs and relative paths at the host contract", async () => {
    const harness = experimental_createHostEntryHarness(
      createWorkbenchHostEntry(),
    );
    await expect(
      harness.experimental_call("collectSecurityContext", {
        cwd: repo,
        range: { base: "--output=/tmp/x", branch: "feature" },
        maxChars: 100_000,
      }),
    ).rejects.toThrow();
    await expect(
      harness.experimental_call("collectSecurityContext", {
        cwd: "relative/path",
        range: null,
        maxChars: 100_000,
      }),
    ).rejects.toThrow();
    await harness.experimental_dispose();
  });
});
