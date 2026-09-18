import { useCallback, useState, type ReactNode } from "react";
import type {
  DiffFileEntry,
  ThreadTaskDiffNotApplicableReason,
  ThreadTaskDiffResponse,
} from "@bb/server-contract";
import { cn } from "@bb/shared-ui/lib/utils";
import { DEFAULT_CODE_OVERFLOW_MODE } from "@/lib/code-overflow-mode";
import {
  DEFAULT_DIFF_VIEW,
  type DiffPresentation,
} from "@/components/code/code-rendering";
import { useThreadTaskDiff } from "@/hooks/queries/thread-queries";
import { GitDiffTabContent } from "../ThreadSecondaryPanelTabContent";
import { TaskDiffHeader } from "./TaskDiffHeader";
import {
  resolveNextTaskDiffFileIndex,
  resolvePreviousTaskDiffFileIndex,
  resolveTaskDiffFileNavDisplay,
} from "./taskDiffFileNav";

const PANEL_SCROLL_SLOT_CLASS =
  "min-h-0 flex-1 overflow-x-auto overflow-y-auto";

const TASK_DIFF_PRESENTATION: DiffPresentation = {
  view: DEFAULT_DIFF_VIEW,
  overflow: DEFAULT_CODE_OVERFLOW_MODE,
  showLineNumbers: true,
};

export interface TaskDiffPanelContentProps {
  threadId: string;
  isPanelOpen: boolean;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onSelectionAddToChat?: (text: string) => void;
  workspaceRootPath?: string | null;
}

type AvailableThreadTaskDiff = Extract<
  ThreadTaskDiffResponse,
  { outcome: "available" }
>;

interface TaskDiffAvailableContentProps {
  taskDiff: AvailableThreadTaskDiff;
  isPanelOpen: boolean;
  onOpenFileInEditor?: (path: string) => void;
  onOpenFilePreview?: (path: string) => void;
  onSelectionAddToChat?: (text: string) => void;
  workspaceRootPath?: string | null;
}

function formatTaskDiffNotApplicableReason(
  reason: ThreadTaskDiffNotApplicableReason,
): string {
  switch (reason) {
    case "no_environment":
      return "This thread has no workspace to diff.";
    case "non_git_environment":
      return "This workspace is not a Git repository.";
  }
}

function buildTaskDiffIdentity(taskDiff: AvailableThreadTaskDiff): string {
  return `${taskDiff.environmentId}:${taskDiff.kind}:${taskDiff.baseBranch ?? ""}:${taskDiff.branchName ?? ""}`;
}

function TaskDiffMessage({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "destructive";
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn(PANEL_SCROLL_SLOT_CLASS, "px-4 pb-3 pt-3")}>
        <div
          className={
            tone === "destructive"
              ? "rounded-lg border border-surface-destructive-border bg-surface-destructive px-3 py-2 text-xs text-destructive"
              : "rounded-lg bg-surface-raised px-3 py-2 text-xs text-muted-foreground"
          }
        >
          <p>{children}</p>
        </div>
      </div>
    </div>
  );
}

function TaskDiffAvailableContent({
  taskDiff,
  isPanelOpen,
  onOpenFileInEditor,
  onOpenFilePreview,
  onSelectionAddToChat,
  workspaceRootPath,
}: TaskDiffAvailableContentProps) {
  const [files, setFiles] = useState<readonly DiffFileEntry[]>([]);
  const [fileIndex, setFileIndex] = useState<number | null>(null);
  const [scrollToPath, setScrollToPath] = useState<string | null>(null);

  const handleFilesChange = useCallback(
    (nextFiles: readonly DiffFileEntry[]) => {
      setFiles(nextFiles);
    },
    [],
  );

  const handleScrolledToPath = useCallback(() => {
    setScrollToPath(null);
  }, []);

  const handleNavigatePrevious = useCallback(() => {
    const nextIndex = resolvePreviousTaskDiffFileIndex(fileIndex, files.length);
    const path = nextIndex !== null ? files[nextIndex]?.path : undefined;
    setFileIndex(nextIndex);
    if (path !== undefined) {
      setScrollToPath(path);
    }
  }, [fileIndex, files]);

  const handleNavigateNext = useCallback(() => {
    const nextIndex = resolveNextTaskDiffFileIndex(fileIndex, files.length);
    const path = nextIndex !== null ? files[nextIndex]?.path : undefined;
    setFileIndex(nextIndex);
    if (path !== undefined) {
      setScrollToPath(path);
    }
  }, [fileIndex, files]);

  const fileNav = resolveTaskDiffFileNavDisplay(fileIndex, files.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TaskDiffHeader
        stats={taskDiff.stats}
        kind={taskDiff.kind}
        baseBranch={taskDiff.baseBranch}
        branchName={taskDiff.branchName}
        fileNav={fileNav}
        onNavigateNext={handleNavigateNext}
        onNavigatePrevious={handleNavigatePrevious}
      />
      <GitDiffTabContent
        environmentId={taskDiff.environmentId}
        target={taskDiff.target}
        isDiffPanelActive
        isPanelOpen={isPanelOpen}
        gitDiffPresentation={TASK_DIFF_PRESENTATION}
        onClearPendingGitDiffIntent={handleScrolledToPath}
        onFilesChange={handleFilesChange}
        onOpenFileInEditor={onOpenFileInEditor}
        onOpenFilePreview={onOpenFilePreview}
        onSelectionAddToChat={onSelectionAddToChat}
        pendingGitDiffScrollPath={scrollToPath}
        workspaceRootPath={workspaceRootPath}
      />
    </div>
  );
}

export function TaskDiffPanelContent({
  threadId,
  isPanelOpen,
  onOpenFileInEditor,
  onOpenFilePreview,
  onSelectionAddToChat,
  workspaceRootPath,
}: TaskDiffPanelContentProps) {
  const {
    data: taskDiff,
    error: taskDiffError,
    isError: isTaskDiffError,
  } = useThreadTaskDiff(threadId, { enabled: isPanelOpen });

  if (isTaskDiffError) {
    return (
      <TaskDiffMessage tone="destructive">
        {taskDiffError instanceof Error
          ? taskDiffError.message
          : "Failed to load task diff."}
      </TaskDiffMessage>
    );
  }

  if (taskDiff === undefined) {
    return <TaskDiffMessage>Loading task diff…</TaskDiffMessage>;
  }

  if (taskDiff.outcome === "not_applicable") {
    return (
      <TaskDiffMessage>
        {formatTaskDiffNotApplicableReason(taskDiff.reason)}
      </TaskDiffMessage>
    );
  }

  if (taskDiff.outcome === "unavailable") {
    return (
      <TaskDiffMessage tone="destructive">
        {taskDiff.failure.message}
      </TaskDiffMessage>
    );
  }

  return (
    <TaskDiffAvailableContent
      key={buildTaskDiffIdentity(taskDiff)}
      taskDiff={taskDiff}
      isPanelOpen={isPanelOpen}
      onOpenFileInEditor={onOpenFileInEditor}
      onOpenFilePreview={onOpenFilePreview}
      onSelectionAddToChat={onSelectionAddToChat}
      workspaceRootPath={workspaceRootPath}
    />
  );
}
