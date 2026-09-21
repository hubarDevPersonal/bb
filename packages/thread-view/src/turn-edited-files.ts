import type {
  TimelineDiffStats,
  TimelineFileChange,
  TimelineRow,
  TimelineTurnEditedFile,
} from "@bb/server-contract";
import type {
  EventProjectionFileEditChange,
  EventProjectionFileEditMessage,
  EventProjectionMessage,
} from "./event-projection-message.js";
import {
  getFileChangeAction,
  getFileChangeDiffStats,
  type FileChangeAction,
} from "./file-change-summary.js";
import type { ThreadTimelineViewRow } from "./timeline-view.js";

type TurnEditedFilesSourceRow = TimelineRow | ThreadTimelineViewRow;

function mergeFileChangeAction(
  previous: FileChangeAction,
  next: FileChangeAction,
): FileChangeAction {
  if (next === "deleted") return "deleted";
  if (previous === "deleted" && next === "created") return "edited";
  if (previous === "created") return "created";
  return next;
}

export function mergeTurnEditedFiles(
  entries: readonly TimelineTurnEditedFile[],
): TimelineTurnEditedFile[] {
  const filesByPath = new Map<string, TimelineTurnEditedFile>();
  for (const entry of entries) {
    const existing = filesByPath.get(entry.path);
    filesByPath.set(
      entry.path,
      existing === undefined
        ? { ...entry }
        : {
            path: entry.path,
            added: existing.added + entry.added,
            removed: existing.removed + entry.removed,
            kind: mergeFileChangeAction(existing.kind, entry.kind),
          },
    );
  }
  return [...filesByPath.values()];
}

function timelineFileChangeEntry(
  change: TimelineFileChange,
): TimelineTurnEditedFile {
  return {
    path: change.movePath ?? change.path,
    added: change.diffStats.added,
    removed: change.diffStats.removed,
    kind: getFileChangeAction(change),
  };
}

function collectRowEntries(
  rows: readonly TurnEditedFilesSourceRow[],
  entries: TimelineTurnEditedFile[],
): void {
  for (const row of rows) {
    switch (row.kind) {
      case "turn":
        entries.push(...row.editedFiles);
        break;
      case "bundle-summary":
      case "step-summary":
        collectRowEntries(row.children, entries);
        break;
      case "work":
        if (row.workKind === "delegation") {
          collectRowEntries(row.childRows, entries);
        } else if (
          row.workKind === "file-change" &&
          row.status === "completed" &&
          row.approvalStatus === null
        ) {
          entries.push(timelineFileChangeEntry(row.change));
        }
        break;
      case "conversation":
      case "system":
        break;
    }
  }
}

export function buildTurnEditedFiles(
  turnRows: readonly TurnEditedFilesSourceRow[],
): TimelineTurnEditedFile[] {
  const entries: TimelineTurnEditedFile[] = [];
  collectRowEntries(turnRows, entries);
  return mergeTurnEditedFiles(entries);
}

function collectMessageEntries(
  messages: readonly EventProjectionMessage[],
  entries: TimelineTurnEditedFile[],
): void {
  for (const message of messages) {
    if (message.kind === "delegation") {
      for (const entry of message.childProjection.entries) {
        if (entry.kind === "projected-message") {
          collectMessageEntries([entry.message], entries);
        } else if (entry.turn.messages === undefined) {
          entries.push(...entry.turn.editedFiles);
        } else {
          collectMessageEntries(entry.turn.messages, entries);
        }
      }
      continue;
    }
    if (
      message.kind !== "file-edit" ||
      message.status !== "completed" ||
      message.approvalStatus !== null
    ) {
      continue;
    }
    entries.push(...fileEditMessageEntries(message));
  }
}

const diffStatsByChange = new WeakMap<
  EventProjectionFileEditChange,
  TimelineDiffStats
>();
const entriesByFileEditMessage = new WeakMap<
  EventProjectionFileEditMessage,
  readonly TimelineTurnEditedFile[]
>();

export function getProjectionFileChangeDiffStats(
  change: EventProjectionFileEditChange,
): TimelineDiffStats {
  const cached = diffStatsByChange.get(change);
  if (cached !== undefined) return cached;
  const stats = getFileChangeDiffStats(change);
  diffStatsByChange.set(change, stats);
  return stats;
}

function fileEditMessageEntries(
  message: EventProjectionFileEditMessage,
): readonly TimelineTurnEditedFile[] {
  const cached = entriesByFileEditMessage.get(message);
  if (cached !== undefined) return cached;
  const entries = message.changes.map((change) => {
    const stats = getProjectionFileChangeDiffStats(change);
    return {
      path: change.movePath ?? change.path,
      added: stats.added,
      removed: stats.removed,
      kind: getFileChangeAction(change),
    };
  });
  entriesByFileEditMessage.set(message, entries);
  return entries;
}

export function getProjectionEditedFiles(
  messages: readonly EventProjectionMessage[],
  terminalMessage: EventProjectionMessage | undefined,
): TimelineTurnEditedFile[] {
  const terminalIndex = terminalMessage
    ? messages.findIndex((message) => message.id === terminalMessage.id)
    : -1;
  const entries: TimelineTurnEditedFile[] = [];
  collectMessageEntries(
    terminalIndex === -1 ? messages : messages.slice(0, terminalIndex),
    entries,
  );
  return mergeTurnEditedFiles(entries);
}

export function relativizeTurnEditedFiles(
  files: readonly TimelineTurnEditedFile[],
  relativize: (path: string) => string,
): TimelineTurnEditedFile[] {
  return mergeTurnEditedFiles(
    files.map((file) => ({ ...file, path: relativize(file.path) })),
  );
}
