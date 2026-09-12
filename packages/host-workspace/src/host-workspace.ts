import {
  ensureGitRepo,
  getCurrentBranch,
  parsePorcelainV2StatusZ,
  readDefaultBranch,
  runGit,
  type GitCommandResult,
  type GitProcessOptions,
  type RunGitOptions,
  WorkspaceError,
  isMissingHeadRevisionError,
  WORKSPACE_STATUS_GIT_TIMEOUT_MS,
} from "bb-environment-provider-host/workspace-git";
import {
  hasUncommittedChanges,
  readSharedGitRefsSnapshot,
  type SharedGitRefsSnapshot,
  revParse,
} from "./git.js";
import { withCheckoutMutationLock } from "./checkout-mutation-lock.js";
import type { HostWorkspace } from "./provision.js";
import {
  resolveAdditionalWorkspaceWriteRoots,
} from "./workspace-write-roots.js";

export interface LocalStateSnapshot {
  fingerprint: string;
  branchName: string | null;
}

export interface CommitOptions {
  message: string;
  noVerify: boolean;
}

export interface CommitResult {
  commitSha: string;
  commitSubject: string;
}

export interface ApplyBranchOptions {
  sourceBranch: string;
}

export type ApplyBranchOutcome =
  | "up_to_date"
  | "fast_forwarded"
  | "merged"
  | "conflict";

export interface ApplyBranchResult {
  outcome: ApplyBranchOutcome;
  commitSha: string | null;
  conflictedFiles: string[];
}

function parseNullSeparatedLines(output: string): string[] {
  return output.split("\0").filter((entry) => entry.length > 0);
}

export class Workspace implements HostWorkspace {
  readonly path: string;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;
  private readonly gitProcessOptions: GitProcessOptions;

  constructor(opts: {
    path: string;
    isGitRepo: boolean;
    isWorktree: boolean;
    shellPath?: string;
  }) {
    this.path = opts.path;
    this.isGitRepo = opts.isGitRepo;
    this.isWorktree = opts.isWorktree;
    this.gitProcessOptions =
      opts.shellPath === undefined ? {} : { shellPath: opts.shellPath };
  }

  private runGit(
    args: string[],
    options: RunGitOptions,
  ): Promise<GitCommandResult> {
    return runGit(args, { ...options, ...this.gitProcessOptions });
  }

  async getCurrentBranch(): Promise<string | null> {
    return (await getCurrentBranch(this.path, this.gitProcessOptions)) ?? null;
  }

  async getDefaultBranch(): Promise<string | null> {
    if (!this.isGitRepo) {
      return null;
    }
    return (
      (await readDefaultBranch(this.path, {
        timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
        ...this.gitProcessOptions,
      })) ?? null
    );
  }

  getAdditionalWorkspaceWriteRoots(): Promise<string[]> {
    if (!this.isGitRepo || !this.isWorktree) {
      return Promise.resolve([]);
    }
    return resolveAdditionalWorkspaceWriteRoots(
      this.path,
      this.gitProcessOptions,
    );
  }

  async getLocalStateSnapshot(): Promise<LocalStateSnapshot> {
    if (!this.isGitRepo)
      await ensureGitRepo(this.path, {
        timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS,
        ...this.gitProcessOptions,
      });
    const status = await this.runGit(
      [
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--branch",
        "-z",
        "--untracked-files=normal",
      ],
      { cwd: this.path, timeoutMs: WORKSPACE_STATUS_GIT_TIMEOUT_MS },
    );
    const { headOid, headBranch } = parsePorcelainV2StatusZ(status.stdout);
    return {
      fingerprint: JSON.stringify({
        headSha: headOid,
        porcelain: status.stdout,
      }),
      branchName: headBranch,
    };
  }

  getSharedGitRefsSnapshot(): Promise<SharedGitRefsSnapshot> {
    return readSharedGitRefsSnapshot(
      this.path,
      this.gitProcessOptions,
      this.isGitRepo,
    );
  }

  async getHeadSha(): Promise<string | null> {
    await ensureGitRepo(this.path, this.gitProcessOptions);

    const result = await this.runGit(["rev-parse", "HEAD"], {
      allowFailure: true,
      cwd: this.path,
    });
    if (result.exitCode === 0) {
      return result.stdout.trim() || null;
    }
    if (isMissingHeadRevisionError(result.stderr)) {
      return null;
    }
    throw new WorkspaceError(
      "git_command_failed",
      `git rev-parse HEAD failed: ${result.stderr.trim()}`,
    );
  }

  async commit(options: CommitOptions): Promise<CommitResult> {
    await ensureGitRepo(this.path, this.gitProcessOptions);

    return withCheckoutMutationLock(
      this.path,
      async () => {
        await this.runGit(["add", "-A"], { cwd: this.path });
        const staged = await this.runGit(["diff", "--cached", "--quiet"], {
          cwd: this.path,
          allowFailure: true,
        });
        if (staged.exitCode === 0) {
          throw new WorkspaceError("no_changes", "No changes to commit");
        }
        const commitArgs = ["commit", "-m", options.message];
        if (options.noVerify) {
          commitArgs.push("--no-verify");
        }
        await this.runGit(commitArgs, { cwd: this.path });
        const commitSha = await revParse(
          this.path,
          "HEAD",
          this.gitProcessOptions,
        );
        const commitSubject = (
          await this.runGit(["log", "-1", "--pretty=%s"], { cwd: this.path })
        ).stdout.trim();

        return { commitSha, commitSubject };
      },
      undefined,
      this.gitProcessOptions,
    );
  }

  async applyBranch(options: ApplyBranchOptions): Promise<ApplyBranchResult> {
    await ensureGitRepo(this.path, this.gitProcessOptions);

    return withCheckoutMutationLock(
      this.path,
      async () => {
        if (!(await this.getCurrentBranch())) {
          throw new WorkspaceError(
            "detached_head",
            `Cannot apply branch into detached checkout at ${this.path}`,
          );
        }

        if (await hasUncommittedChanges(this.path, this.gitProcessOptions)) {
          throw new WorkspaceError(
            "dirty_target_checkout",
            `Cannot apply branch: checkout at ${this.path} has uncommitted changes`,
          );
        }

        const headResult = await this.runGit(
          ["rev-parse", "--verify", "HEAD^{commit}"],
          { cwd: this.path, allowFailure: true },
        );
        if (headResult.exitCode !== 0) {
          throw new WorkspaceError(
            "git_command_failed",
            `git rev-parse --verify HEAD^{commit} failed: ${headResult.stderr.trim()}`,
          );
        }
        const headSha = headResult.stdout.trim();

        const sourceRef = `refs/heads/${options.sourceBranch}`;
        const sourceResult = await this.runGit(
          ["rev-parse", "--verify", `${sourceRef}^{commit}`],
          { cwd: this.path, allowFailure: true },
        );
        if (sourceResult.exitCode !== 0) {
          throw new WorkspaceError(
            "branch_not_found",
            `Source branch does not exist: ${options.sourceBranch}`,
          );
        }
        const sourceSha = sourceResult.stdout.trim();

        const sourceIsMerged = await this.isAncestor(sourceSha, headSha);
        if (sourceIsMerged === undefined) {
          throw new WorkspaceError(
            "git_command_failed",
            `git merge-base --is-ancestor ${options.sourceBranch} HEAD failed`,
          );
        }
        if (sourceIsMerged) {
          return {
            outcome: "up_to_date",
            commitSha: headSha,
            conflictedFiles: [],
          };
        }

        const headIsAncestor = await this.isAncestor(headSha, sourceSha);
        if (headIsAncestor === undefined) {
          throw new WorkspaceError(
            "git_command_failed",
            `git merge-base --is-ancestor HEAD ${options.sourceBranch} failed`,
          );
        }
        if (headIsAncestor) {
          await this.ensureNoIgnoredFileOverlap(headSha, sourceSha);
          try {
            await this.runGit(["merge", "--ff-only", sourceSha], {
              cwd: this.path,
            });
          } catch (error) {
            await this.runGit(["merge", "--abort"], {
              cwd: this.path,
              allowFailure: true,
            });
            throw error;
          }
          const commitSha = await revParse(
            this.path,
            "HEAD",
            this.gitProcessOptions,
          );
          return { outcome: "fast_forwarded", commitSha, conflictedFiles: [] };
        }

        const mergeTree = await this.runGit(
          [
            "merge-tree",
            "--write-tree",
            "--name-only",
            "--no-messages",
            "-z",
            headSha,
            sourceSha,
          ],
          { cwd: this.path, allowFailure: true },
        );
        if (mergeTree.exitCode === 1) {
          const [treeId, ...conflictedFiles] = parseNullSeparatedLines(
            mergeTree.stdout,
          );
          if (!treeId || !/^[0-9a-f]{40,64}$/u.test(treeId)) {
            throw new WorkspaceError(
              "git_command_failed",
              `git merge-tree returned unexpected output: ${mergeTree.stdout.trim()}`,
            );
          }
          return { outcome: "conflict", commitSha: null, conflictedFiles };
        }
        if (mergeTree.exitCode !== 0) {
          throw new WorkspaceError(
            "git_command_failed",
            `git merge-tree failed (exit ${mergeTree.exitCode}): ${mergeTree.stderr.trim()}`,
          );
        }

        await this.ensureNoIgnoredFileOverlap(headSha, sourceSha);
        try {
          await this.runGit(
            [
              "merge",
              "--no-ff",
              "--no-edit",
              "--no-verify",
              "-m",
              `Merge branch '${options.sourceBranch}'`,
              sourceSha,
            ],
            { cwd: this.path },
          );
        } catch (error) {
          await this.runGit(["merge", "--abort"], {
            cwd: this.path,
            allowFailure: true,
          });
          throw error;
        }
        const commitSha = await revParse(
          this.path,
          "HEAD",
          this.gitProcessOptions,
        );
        return { outcome: "merged", commitSha, conflictedFiles: [] };
      },
      undefined,
      this.gitProcessOptions,
    );
  }

  private async isAncestor(
    ancestorRef: string,
    descendantRef: string,
  ): Promise<boolean | undefined> {
    const result = await this.runGit(
      ["merge-base", "--is-ancestor", ancestorRef, descendantRef],
      { cwd: this.path, allowFailure: true },
    );
    if (result.exitCode === 0) {
      return true;
    }
    if (result.exitCode === 1) {
      return false;
    }
    return undefined;
  }

  private async ensureNoIgnoredFileOverlap(
    headSha: string,
    sourceSha: string,
  ): Promise<void> {
    const ignored = await this.runGit(
      [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "-z",
      ],
      { cwd: this.path },
    );
    const ignoredEntries = parseNullSeparatedLines(ignored.stdout);
    if (ignoredEntries.length === 0) {
      return;
    }

    const diff = await this.runGit(
      ["diff", "--name-only", "-z", headSha, sourceSha],
      { cwd: this.path },
    );
    const overlapping = parseNullSeparatedLines(diff.stdout).filter((file) =>
      ignoredEntries.some((entry) =>
        entry.endsWith("/") ? file.startsWith(entry) : file === entry,
      ),
    );
    if (overlapping.length > 0) {
      throw new WorkspaceError(
        "ignored_files_would_be_overwritten",
        `Applying branch would overwrite ignored files: ${overlapping.join(", ")}`,
      );
    }
  }
}
