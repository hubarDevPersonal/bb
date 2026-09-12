import type { SidebarThread } from "../model/sidebar-thread.js";
import { useThreadRowTaskDiffStatsVisible } from "./threadRowTaskDiffContext.js";

const DIFF_COUNT_FORMATTER = new Intl.NumberFormat("en-US");

export function ThreadRowTaskDiffStats({ thread }: { thread: SidebarThread }) {
  const visible = useThreadRowTaskDiffStatsVisible();
  const stats = thread.experimental_taskDiffStats;
  if (!visible || stats === null || stats.changedFiles === 0) {
    return null;
  }
  return (
    <span
      className="shrink-0 whitespace-nowrap text-2xs tabular-nums"
      aria-label={`${stats.insertions} lines added, ${stats.deletions} lines removed`}
    >
      <span className="text-diff-added">
        +{DIFF_COUNT_FORMATTER.format(stats.insertions)}
      </span>{" "}
      <span className="text-diff-removed">
        −{DIFF_COUNT_FORMATTER.format(stats.deletions)}
      </span>
    </span>
  );
}
