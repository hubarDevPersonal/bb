import { formatDiffCount } from "@bb/thread-view";
import { Button } from "@bb/shared-ui/button";
import type { ThreadTaskActionsState } from "./useThreadTaskActions";

interface ShouldShowThreadTaskReadyBannerArgs {
  canReview: boolean;
  hasCompletedTurn: boolean;
}

export function shouldShowThreadTaskReadyBanner({
  canReview,
  hasCompletedTurn,
}: ShouldShowThreadTaskReadyBannerArgs): boolean {
  return canReview && hasCompletedTurn;
}

interface ThreadTaskReadyBannerProps {
  hasCompletedTurn: boolean;
  taskActions: ThreadTaskActionsState;
}

export function ThreadTaskReadyBanner({
  hasCompletedTurn,
  taskActions,
}: ThreadTaskReadyBannerProps) {
  const isVisible = shouldShowThreadTaskReadyBanner({
    canReview: taskActions.canReview,
    hasCompletedTurn,
  });

  if (!isVisible || !taskActions.stats) {
    return null;
  }

  const { stats } = taskActions;

  return (
    <div className="mb-2 min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-surface-recessed px-4 py-3 text-xs text-muted-foreground">
      <h3 className="min-w-0 text-sm font-semibold text-foreground">
        Task is ready for review
      </h3>
      <p className="mt-1 whitespace-nowrap text-2xs tabular-nums">
        <span className="text-diff-added">
          +{formatDiffCount(stats.insertions)}
        </span>{" "}
        <span className="text-diff-removed">
          −{formatDiffCount(stats.deletions)}
        </span>{" "}
        <span>
          · {stats.changedFiles} {stats.changedFiles === 1 ? "file" : "files"}
        </span>
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={taskActions.pending}
          onClick={taskActions.review}
        >
          Review
        </Button>
        {taskActions.canApply ? (
          <Button
            type="button"
            size="sm"
            disabled={taskActions.pending}
            onClick={taskActions.apply}
          >
            Apply changes locally
          </Button>
        ) : null}
      </div>
    </div>
  );
}
