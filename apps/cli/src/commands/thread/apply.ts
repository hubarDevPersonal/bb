import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

interface ThreadApplyCommandOptions {
  self?: boolean;
  json?: boolean;
}

export function registerApplyCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("apply [id]")
    .description(
      "Apply the thread's branch locally into the project's main checkout",
    )
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadApplyCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          const diffResult = await sdk.threads.taskDiff({ threadId });
          const sourceBranch =
            diffResult.outcome === "available" ? diffResult.branchName : null;
          const result = await sdk.threads.applyLocally({ threadId });
          if (outputJson(opts, result)) {
            if (result.outcome === "conflict") process.exit(1);
            return;
          }

          console.log(
            sourceBranch
              ? `Applied ${sourceBranch} into ${result.targetBranch} (${result.outcome})`
              : `Applied changes into ${result.targetBranch} (${result.outcome})`,
          );
          if (result.commitSha) {
            console.log(`  Commit: ${result.commitSha}`);
          }
          if (result.outcome === "conflict") {
            console.log("  Conflicted files:");
            for (const file of result.conflictedFiles) {
              console.log(`    ${file}`);
            }
            process.exit(1);
          }
        },
      ),
    );
}
