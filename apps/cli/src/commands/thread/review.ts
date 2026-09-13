import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

interface ThreadReviewCommandOptions {
  self?: boolean;
  json?: boolean;
}

export function registerReviewCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("review [id]")
    .description("Create a review thread for the thread's task diff")
    .option("--self", "Target the current thread (from BB_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadReviewCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          const thread = await sdk.threads.review({ threadId });
          if (outputJson(opts, thread)) return;

          console.log(`Review thread created: ${thread.id}`);
          console.log(`Source: ${threadId}`);
          console.log(`Status: ${thread.status}`);
        },
      ),
    );
}
