import { memo, useCallback, useMemo, useState } from "react";
import type { TimelineTurnEditedFile } from "@bb/server-contract";
import { buildTurnEditedFiles, formatDiffCount } from "@bb/thread-view";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  resolveEditedFileIconKind,
  type EditedFileIconKind,
  type TurnEditedFilesAnchor,
} from "./turn-edited-files.js";
import type { ThreadTimelineViewTurnChangesHandler } from "./types.js";

type TurnEditedFile = TimelineTurnEditedFile;

export const TURN_EDITED_FILES_COLLAPSED_LIMIT = 8;

const EDITED_FILE_ICON: Record<EditedFileIconKind, IconName> = {
  code: "Code",
  markdown: "FileText",
  json: "ListView",
  other: "File",
};

type OpenEditedFileHandler = (path: string) => void;

interface TurnEditedFilesCardProps {
  files: readonly TurnEditedFile[];
  onOpenFile: OpenEditedFileHandler | null;
  onViewChanges: (() => void) | null;
}

interface TurnEditedFileRowProps {
  file: TurnEditedFile;
  onOpenFile: OpenEditedFileHandler | null;
}

interface TurnEditedFilesSummaryProps {
  anchor: TurnEditedFilesAnchor;
  onViewChanges: ThreadTimelineViewTurnChangesHandler;
}

const ROW_CLASS_NAME =
  "flex min-h-9 w-full min-w-0 items-center gap-2 border-t border-border-seam px-3 text-left text-sm";

function fileBaseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function TurnEditedFileRowContent({ file }: { file: TurnEditedFile }) {
  return (
    <>
      <Icon
        name={EDITED_FILE_ICON[resolveEditedFileIconKind(file.path)]}
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-foreground">
        {fileBaseName(file.path)}
      </span>
      <span className="shrink-0 whitespace-nowrap tabular-nums">
        {file.kind === "deleted" ? null : (
          <span className="text-diff-added">
            +{formatDiffCount(file.added)}
          </span>
        )}
        {file.kind === "deleted" ? null : " "}
        <span className="text-diff-removed">
          {"−"}
          {formatDiffCount(file.removed)}
        </span>
      </span>
    </>
  );
}

function TurnEditedFileRow({ file, onOpenFile }: TurnEditedFileRowProps) {
  const handleClick = useCallback(() => {
    onOpenFile?.(file.path);
  }, [file.path, onOpenFile]);
  if (onOpenFile === null) {
    return (
      <li className={ROW_CLASS_NAME} title={file.path}>
        <TurnEditedFileRowContent file={file} />
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        title={file.path}
        onClick={handleClick}
        className={cn(ROW_CLASS_NAME, "hover:bg-state-hover")}
      >
        <TurnEditedFileRowContent file={file} />
        <Icon
          name="ChevronRight"
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      </button>
    </li>
  );
}

export function TurnEditedFilesCard({
  files,
  onOpenFile,
  onViewChanges,
}: TurnEditedFilesCardProps) {
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => {
    setExpanded((current) => !current);
  }, []);
  const hiddenCount = Math.max(
    0,
    files.length - TURN_EDITED_FILES_COLLAPSED_LIMIT,
  );
  const visibleFiles =
    expanded || hiddenCount === 0
      ? files
      : files.slice(0, TURN_EDITED_FILES_COLLAPSED_LIMIT);

  return (
    <section
      aria-label="Edited files"
      className="mt-2 overflow-hidden rounded-xl bg-surface-raised-solid"
    >
      <div className="flex min-h-9 items-center justify-between gap-2 px-3">
        <span className="text-sm font-medium text-foreground">
          Edited {files.length} {files.length === 1 ? "file" : "files"}
        </span>
        {onViewChanges === null ? null : (
          <button
            type="button"
            onClick={onViewChanges}
            className="inline-flex h-6 shrink-0 items-center rounded-full border border-border bg-transparent px-2.5 text-xs text-foreground hover:bg-state-hover"
          >
            View changes
          </button>
        )}
      </div>
      <ul>
        {visibleFiles.map((file) => (
          <TurnEditedFileRow
            key={file.path}
            file={file}
            onOpenFile={onOpenFile}
          />
        ))}
        {hiddenCount === 0 ? null : (
          <li>
            <button
              type="button"
              aria-expanded={expanded}
              onClick={toggleExpanded}
              className={cn(
                ROW_CLASS_NAME,
                "text-muted-foreground hover:bg-state-hover",
              )}
            >
              {expanded ? "Show less" : `+${hiddenCount} more`}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function areTurnEditedFilesSummaryPropsEqual(
  previous: TurnEditedFilesSummaryProps,
  next: TurnEditedFilesSummaryProps,
): boolean {
  return (
    previous.onViewChanges === next.onViewChanges &&
    previous.anchor.turnId === next.anchor.turnId &&
    previous.anchor.rows.length === next.anchor.rows.length &&
    previous.anchor.rows.every((row, index) => row === next.anchor.rows[index])
  );
}

export const TurnEditedFilesSummary = memo(function TurnEditedFilesSummary({
  anchor,
  onViewChanges,
}: TurnEditedFilesSummaryProps) {
  const files = useMemo(() => buildTurnEditedFiles(anchor.rows), [anchor.rows]);
  const handleViewChanges = useCallback(() => {
    onViewChanges(files.map((file) => file.path));
  }, [files, onViewChanges]);
  const handleOpenFile = useCallback(
    (path: string) => {
      onViewChanges([path]);
    },
    [onViewChanges],
  );

  if (files.length === 0) {
    return null;
  }
  return (
    <TurnEditedFilesCard
      files={files}
      onOpenFile={handleOpenFile}
      onViewChanges={handleViewChanges}
    />
  );
}, areTurnEditedFilesSummaryPropsEqual);
