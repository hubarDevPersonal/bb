import type { TaskDiffStats } from "@bb/domain";
import type { ThreadTaskDiffKind } from "@bb/server-contract";
import { formatDiffCount } from "@bb/thread-view";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import type { TaskDiffFileNavDisplay } from "./taskDiffFileNav";

export function formatTaskDiffKindLabel({
  kind,
  baseBranch,
  branchName,
}: {
  kind: ThreadTaskDiffKind;
  baseBranch: string | null;
  branchName: string | null;
}): string {
  if (kind === "working_tree") {
    return "Working tree vs HEAD";
  }
  if (baseBranch && branchName) {
    return `${baseBranch}…${branchName}`;
  }
  return branchName ?? baseBranch ?? "Branch diff";
}

export interface TaskDiffHeaderProps {
  stats: TaskDiffStats;
  kind: ThreadTaskDiffKind;
  baseBranch: string | null;
  branchName: string | null;
  fileNav: TaskDiffFileNavDisplay;
  onNavigateNext: () => void;
  onNavigatePrevious: () => void;
}

export function TaskDiffHeader({
  stats,
  kind,
  baseBranch,
  branchName,
  fileNav,
  onNavigateNext,
  onNavigatePrevious,
}: TaskDiffHeaderProps) {
  const kindLabel = formatTaskDiffKindLabel({ baseBranch, branchName, kind });

  return (
    <div className="flex min-w-0 items-center justify-between gap-2 px-4 pb-3 pt-3">
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 whitespace-nowrap text-2xs tabular-nums">
          <span className="text-diff-added">
            +{formatDiffCount(stats.insertions)}
          </span>{" "}
          <span className="text-diff-removed">
            −{formatDiffCount(stats.deletions)}
          </span>
        </span>
        <span className="min-w-0 truncate text-2xs text-muted-foreground">
          {kindLabel}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="whitespace-nowrap text-2xs tabular-nums text-muted-foreground">
          {fileNav.currentOneBased} / {fileNav.fileCount} files
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                "text-muted-foreground",
              )}
              onClick={onNavigatePrevious}
              disabled={fileNav.isPrevDisabled}
              aria-label="Previous changed file"
            >
              <Icon name="ChevronLeft" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Previous file</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                COARSE_POINTER_COMPACT_ICON_BUTTON_CLASS,
                "text-muted-foreground",
              )}
              onClick={onNavigateNext}
              disabled={fileNav.isNextDisabled}
              aria-label="Next changed file"
            >
              <Icon name="ChevronRight" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Next file</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
