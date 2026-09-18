import type { BbPluginApi } from "@get-bb/plugin-sdk";

type SdkThreads = BbPluginApi["sdk"]["threads"];

export type SubagentThreadEntry = Awaited<
  ReturnType<SdkThreads["list"]>
>[number];
export type TimelineRow = Awaited<
  ReturnType<SdkThreads["timeline"]>
>["rows"][number];
export type TimelinePageMetadata = Awaited<
  ReturnType<SdkThreads["timeline"]>
>["timelinePage"];

type SubagentDisplayStatus = SubagentThreadEntry["runtime"]["displayStatus"];
export type SubagentStatus = "active" | "done";

export function subagentStatus(
  displayStatus: SubagentDisplayStatus,
): SubagentStatus {
  switch (displayStatus) {
    case "idle":
    case "error":
      return "done";
    case "starting":
    case "active":
    case "stopping":
    case "provisioning":
    case "host-reconnecting":
    case "waiting-for-host":
      return "active";
  }
}

export function subagentTitle(
  entry: Pick<SubagentThreadEntry, "id" | "title" | "titleFallback">,
): string {
  return entry.title ?? entry.titleFallback ?? `Subagent ${entry.id}`;
}

export interface SubagentRow {
  id: string;
  title: string;
  status: SubagentStatus;
  updatedAt: string;
}

export function subagentRow(entry: SubagentThreadEntry): SubagentRow {
  return {
    id: entry.id,
    title: subagentTitle(entry),
    status: subagentStatus(entry.runtime.displayStatus),
    updatedAt: new Date(entry.updatedAt).toISOString(),
  };
}

export interface TimelineFileChangeEntry {
  path: string;
  kind: string | null;
}

export function flattenFileChangeRows(
  rows: readonly TimelineRow[],
): TimelineFileChangeEntry[] {
  const changes: TimelineFileChangeEntry[] = [];
  for (const row of rows) {
    if (row.kind === "turn") {
      if (row.children !== null) {
        changes.push(...flattenFileChangeRows(row.children));
      }
      continue;
    }
    if (row.kind === "work" && row.workKind === "file-change") {
      changes.push({ path: row.change.path, kind: row.change.kind });
    }
  }
  return changes;
}

export function extractCreatedFilePaths(
  changesNewestFirst: readonly TimelineFileChangeEntry[],
): string[] {
  const resolved = new Set<string>();
  const created: string[] = [];
  for (const change of changesNewestFirst) {
    if (resolved.has(change.path)) continue;
    if (change.kind === "delete") {
      resolved.add(change.path);
      continue;
    }
    if (change.kind === "add") {
      resolved.add(change.path);
      created.push(change.path);
    }
  }
  return created;
}
