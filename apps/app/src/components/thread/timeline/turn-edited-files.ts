import type { ThreadTimelineViewRow } from "@bb/thread-view";

export type EditedFileIconKind = "code" | "markdown" | "json" | "other";

export interface TurnEditedFilesAnchor {
  turnId: string;
  rows: readonly ThreadTimelineViewRow[];
}

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);
const JSON_EXTENSIONS = new Set(["json", "jsonc", "json5", "jsonl"]);
const CODE_EXTENSIONS = new Set([
  "bash",
  "c",
  "cc",
  "cjs",
  "cpp",
  "cs",
  "css",
  "cts",
  "dart",
  "ex",
  "exs",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "lua",
  "mjs",
  "mts",
  "php",
  "py",
  "rb",
  "rs",
  "scala",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "ts",
  "tsx",
  "vue",
  "zsh",
]);

function fileExtension(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dotIndex = name.lastIndexOf(".");
  return dotIndex <= 0 ? "" : name.slice(dotIndex + 1).toLowerCase();
}

export function resolveEditedFileIconKind(path: string): EditedFileIconKind {
  const extension = fileExtension(path);
  if (MARKDOWN_EXTENSIONS.has(extension)) return "markdown";
  if (JSON_EXTENSIONS.has(extension)) return "json";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  return "other";
}

function isCompletedTurnRow(row: ThreadTimelineViewRow): boolean {
  return (
    row.kind === "turn" && row.status !== "pending" && row.completedAt !== null
  );
}

export function collectCompletedTurnEditedFilesAnchors(
  rows: readonly ThreadTimelineViewRow[],
): ReadonlyMap<string, TurnEditedFilesAnchor> {
  const groups = new Map<
    string,
    { completed: boolean; lastRowId: string; rows: ThreadTimelineViewRow[] }
  >();
  for (const row of rows) {
    if (row.turnId === null) continue;
    const group = groups.get(row.turnId);
    if (group === undefined) {
      groups.set(row.turnId, {
        completed: isCompletedTurnRow(row),
        lastRowId: row.id,
        rows: [row],
      });
      continue;
    }
    group.completed ||= isCompletedTurnRow(row);
    group.lastRowId = row.id;
    group.rows.push(row);
  }
  const anchors = new Map<string, TurnEditedFilesAnchor>();
  for (const [turnId, group] of groups) {
    if (group.completed) {
      anchors.set(group.lastRowId, { turnId, rows: group.rows });
    }
  }
  return anchors;
}
