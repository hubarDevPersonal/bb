import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

interface ThreadDiffCommandOptions {
  self?: boolean;
  json?: boolean;
}

export function registerDiffCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("diff [id]")
    .description("Show the thread's task diff stats against its base")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string | undefined, opts: ThreadDiffCommandOptions) => {
        const threadId = requireThreadIdOrSelf(id, opts);
        const sdk = createCliBbSdk(getUrl());
        const result = await sdk.threads.taskDiff({ threadId });
        if (outputJson(opts, result)) return;

        if (result.outcome === "not_applicable") {
          console.log(`Task diff: not applicable (${result.reason})`);
          return;
        }
        if (result.outcome === "unavailable") {
          console.log(`Task diff: unavailable (${result.failure.message})`);
          return;
        }
        console.log(`Task diff: ${result.kind}`);
        if (result.baseBranch) {
          console.log(`  Base branch: ${result.baseBranch}`);
        }
        if (result.branchName) {
          console.log(`  Branch:      ${result.branchName}`);
        }
        console.log(`  Changed files: ${result.stats.changedFiles}`);
        console.log(`  Insertions:    +${result.stats.insertions}`);
        console.log(`  Deletions:     -${result.stats.deletions}`);
      }),
    );
}
