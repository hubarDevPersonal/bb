import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type {
  SecurityContextInput,
  SecurityContextResult,
} from "./contract.js";
import {
  isSecretLikePath,
  redactDiffSecrets,
  redactSecrets,
} from "./secret-redaction.js";

const SECURITY_SPEC_FILE = ".claude/specs/security.md";
const PROJECT_SPEC_FILE = ".claude/specs/PROJECT.md";
const SPEC_MAX_CHARS = 200_000;
const SPEC_MAX_BYTES = 1024 * 1024;
const NAME_LIST_MAX_CHARS = 2_000_000;
const TOO_MANY_FILES_ERROR = "too many changed files to list safely";
const UNTRACKED_FILE_MAX_BYTES = 256 * 1024;
const GIT_STDERR_MAX_CHARS = 2_000;
const DIFF_FLAGS = [
  "diff",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-renames",
] as const;

export interface GitOutput {
  stdout: string;
  truncated: boolean;
}

export interface NoFollowHandle {
  stat(): Promise<{ isFile(): boolean; size: number }>;
  readFile(): Promise<Buffer>;
  close(): Promise<void>;
}

export interface SecurityContextDeps {
  runGit(
    cwd: string,
    args: readonly string[],
    maxChars: number,
  ): Promise<GitOutput>;
  readFile(filePath: string): Promise<Buffer>;
  stat(filePath: string): Promise<{ isFile(): boolean; size: number }>;
  realpath(filePath: string): Promise<string>;
  openNoFollow(filePath: string): Promise<NoFollowHandle>;
  homeDir(): string;
}

export function runGitCommand(
  cwd: string,
  args: readonly string[],
  maxChars: number,
): Promise<GitOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-c", "core.quotepath=off", ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
    });
    let stdout = "";
    let stderr = "";
    let truncated = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (truncated) return;
      stdout += chunk;
      if (stdout.length > maxChars) {
        stdout = stdout.slice(0, maxChars);
        truncated = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < GIT_STDERR_MAX_CHARS) stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (truncated || code === 0) {
        resolve({ stdout, truncated });
        return;
      }
      reject(
        new Error(
          `git ${args[0]} exited with ${code ?? "a signal"}: ${stderr.trim().slice(0, GIT_STDERR_MAX_CHARS)}`,
        ),
      );
    });
  });
}

export const defaultSecurityContextDeps: SecurityContextDeps = {
  runGit: runGitCommand,
  readFile: (filePath) => readFile(filePath),
  stat: (filePath) => stat(filePath),
  realpath: (filePath) => realpath(filePath),
  openNoFollow: (filePath) =>
    open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    ),
  homeDir: homedir,
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

function truncateSpec(content: string): string {
  return content.length > SPEC_MAX_CHARS
    ? content.slice(0, SPEC_MAX_CHARS)
    : content;
}

async function readSecuritySpec(
  deps: SecurityContextDeps,
): Promise<string | null> {
  const filePath = path.join(deps.homeDir(), SECURITY_SPEC_FILE);
  try {
    const info = await deps.stat(filePath);
    if (!info.isFile() || info.size > SPEC_MAX_BYTES) return null;
    return truncateSpec((await deps.readFile(filePath)).toString("utf8"));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

type WorkspaceFileRead =
  | { ok: true; content: Buffer }
  | {
      ok: false;
      reason: "missing" | "outside" | "not_regular" | "too_large";
    };

function isInside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function readWorkspaceFile(
  deps: SecurityContextDeps,
  cwd: string,
  relative: string,
  maxBytes: number,
): Promise<WorkspaceFileRead> {
  const absolute = path.resolve(cwd, relative);
  let root: string;
  let parent: string;
  try {
    root = await deps.realpath(cwd);
    parent = await deps.realpath(path.dirname(absolute));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: false, reason: "missing" };
    throw error;
  }
  if (!isInside(root, parent)) return { ok: false, reason: "outside" };
  let handle: NoFollowHandle;
  try {
    handle = await deps.openNoFollow(
      path.join(parent, path.basename(absolute)),
    );
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return { ok: false, reason: "missing" };
    if (code === "ELOOP" || code === "EMLINK" || code === "ENXIO") {
      return { ok: false, reason: "not_regular" };
    }
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { ok: false, reason: "not_regular" };
    if (info.size > maxBytes) return { ok: false, reason: "too_large" };
    return { ok: true, content: await handle.readFile() };
  } finally {
    await handle.close();
  }
}

async function readProjectSpec(
  deps: SecurityContextDeps,
  cwd: string,
): Promise<{ content: string | null; rejected: boolean }> {
  const read = await readWorkspaceFile(
    deps,
    cwd,
    PROJECT_SPEC_FILE,
    SPEC_MAX_BYTES,
  );
  if (read.ok) {
    return {
      content: truncateSpec(read.content.toString("utf8")),
      rejected: false,
    };
  }
  return { content: null, rejected: read.reason !== "missing" };
}

function isSecretLike(file: string): boolean {
  return isSecretLikePath(file);
}

function redactionNote(file: string, count: number): string {
  return `${count} ${count === 1 ? "value" : "values"} redacted in ${file}`;
}

function nulSeparated(output: string): string[] {
  return output.split("\0").filter((entry) => entry.length > 0);
}

function untrackedDiff(file: string, content: string): string {
  const body = content.endsWith("\n") ? content.slice(0, -1) : content;
  const lines = body.length === 0 ? [] : body.split("\n");
  return [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644 (untracked)",
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

export async function collectSecurityContext(
  input: SecurityContextInput,
  deps: SecurityContextDeps,
): Promise<SecurityContextResult> {
  const range =
    input.range === null
      ? "HEAD"
      : `${input.range.base}...${input.range.branch}`;
  let diff: GitOutput;
  let changed: string[];
  try {
    const names = await deps.runGit(
      input.cwd,
      [
        "diff",
        "--name-only",
        "-z",
        "--no-ext-diff",
        "--no-renames",
        range,
        "--",
      ],
      NAME_LIST_MAX_CHARS,
    );
    if (names.truncated) {
      return { ok: false, error: TOO_MANY_FILES_ERROR };
    }
    changed = nulSeparated(names.stdout);
    diff = await deps.runGit(
      input.cwd,
      [
        ...DIFF_FLAGS,
        range,
        "--",
        ...changed
          .filter(isSecretLike)
          .map((file) => `:(top,exclude,literal)${file}`),
      ],
      input.maxChars,
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const files = changed.filter((file) => !isSecretLike(file));
  const untracked: string[] = [];
  const skipped = changed
    .filter(isSecretLike)
    .map((file) => `${file} (secret-like name)`);
  const redacted = redactDiffSecrets(diff.stdout);
  const redactions: string[] = [...redacted.counts].map(([file, count]) =>
    redactionNote(file, count),
  );
  let text = redacted.text;
  let truncated = diff.truncated;
  if (input.range === null) {
    let listed: GitOutput;
    try {
      listed = await deps.runGit(
        input.cwd,
        ["ls-files", "--others", "--exclude-standard", "-z"],
        NAME_LIST_MAX_CHARS,
      );
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (listed.truncated) {
      return { ok: false, error: TOO_MANY_FILES_ERROR };
    }
    for (const file of nulSeparated(listed.stdout).sort()) {
      if (isSecretLike(file)) {
        skipped.push(`${file} (secret-like name)`);
        continue;
      }
      const read = await readWorkspaceFile(
        deps,
        input.cwd,
        file,
        UNTRACKED_FILE_MAX_BYTES,
      ).catch(() => null);
      if (read === null) {
        skipped.push(`${file} (unreadable)`);
        continue;
      }
      if (!read.ok) {
        skipped.push(
          read.reason === "too_large"
            ? `${file} (larger than ${UNTRACKED_FILE_MAX_BYTES} bytes)`
            : read.reason === "outside"
              ? `${file} (outside the workspace)`
              : `${file} (not a regular file)`,
        );
        continue;
      }
      if (read.content.includes(0)) {
        skipped.push(`${file} (binary)`);
        continue;
      }
      untracked.push(file);
      files.push(file);
      if (truncated) continue;
      const content = redactSecrets(read.content.toString("utf8"));
      if (content.count > 0) {
        redactions.push(redactionNote(file, content.count));
      }
      text += untrackedDiff(file, content.text);
      if (text.length > input.maxChars) {
        text = text.slice(0, input.maxChars);
        truncated = true;
      }
    }
  }
  const [securitySpec, projectSpec] = await Promise.all([
    readSecuritySpec(deps),
    readProjectSpec(deps, input.cwd),
  ]);
  if (projectSpec.rejected) {
    skipped.push(
      `${PROJECT_SPEC_FILE} (not a regular file inside the workspace)`,
    );
  }
  return {
    ok: true,
    diff: text,
    truncated,
    files,
    untracked,
    skipped: [...skipped, ...redactions],
    securitySpec,
    projectSpec: projectSpec.content,
  };
}
