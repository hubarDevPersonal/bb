export const AGENT_ROLES = ["scout", "implementer", "reviewer"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type AgentEffortLevel = (typeof AGENT_EFFORT_LEVELS)[number];

export const ROUTING_ROLES = [
  "architect",
  "implementer",
  "scout",
  "reviewer-cross-vendor",
  "reviewer-subagent",
] as const;
export type RoutingRole = (typeof ROUTING_ROLES)[number];

export interface RoutingEntry {
  role: RoutingRole;
  providerId: string;
  model: string;
  subagentModel: string | null;
  effort: string | null;
}

export interface CatalogModelOption {
  id: string;
  displayName: string;
}

const ROLE_LABELS: ReadonlyArray<readonly [string, RoutingRole]> = [
  ["architect", "architect"],
  ["implementer", "implementer"],
  ["scout", "scout"],
  ["reviewer, кросс-вендорный", "reviewer-cross-vendor"],
  ["reviewer, внутри треда", "reviewer-subagent"],
];

const AGENT_ROUTING_ROLE: Readonly<Record<AgentRole, RoutingRole>> = {
  scout: "scout",
  implementer: "implementer",
  reviewer: "reviewer-subagent",
};

const BOLD_PATTERN = /\*\*([^*]+)\*\*/;
const MODEL_CELL_PATTERN = /^([^`/]+?)\s*\/\s*`([^`]+)`/;
const SUBAGENT_MODEL_PATTERN = /субагент:\s*`([^`]+)`/;

function stripBold(value: string): string {
  return value.replace(/\*\*/g, "").trim();
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const inner = trimmed.endsWith("|") ? trimmed.slice(1, -1) : trimmed.slice(1);
  return inner.split("|");
}

function roleForLabelCell(cell: string): RoutingRole | null {
  const bold = BOLD_PATTERN.exec(cell);
  if (bold === null) return null;
  const label = normalizeLabel(bold[1]!);
  return ROLE_LABELS.find(([candidate]) => candidate === label)?.[1] ?? null;
}

function parseRow(cells: readonly string[]): RoutingEntry | null {
  const role = roleForLabelCell(cells[0] ?? "");
  if (role === null) return null;
  for (let index = 1; index < cells.length; index += 1) {
    const cell = stripBold(cells[index]!);
    const match = MODEL_CELL_PATTERN.exec(cell);
    if (match === null) continue;
    const providerId = match[1]!.trim();
    const model = match[2]!.trim();
    if (
      providerId.length === 0 ||
      /\s/.test(providerId) ||
      model.length === 0
    ) {
      return null;
    }
    const subagentModel = SUBAGENT_MODEL_PATTERN.exec(cell)?.[1]?.trim();
    const effortCell = cells[index + 1];
    const effort = effortCell === undefined ? "" : stripBold(effortCell);
    return {
      role,
      providerId,
      model,
      subagentModel:
        subagentModel === undefined || subagentModel.length === 0
          ? null
          : subagentModel,
      effort: effort.length === 0 ? null : effort,
    };
  }
  return null;
}

export function parseRoutingTable(markdown: string): RoutingEntry[] {
  const entries: RoutingEntry[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (cells === null) continue;
    const entry = parseRow(cells);
    if (entry === null) continue;
    if (entries.some((existing) => existing.role === entry.role)) continue;
    entries.push(entry);
  }
  return entries;
}

export function routingEntryFor(
  entries: readonly RoutingEntry[],
  role: RoutingRole,
): RoutingEntry | null {
  return entries.find((entry) => entry.role === role) ?? null;
}

export function routingEntryForAgent(
  entries: readonly RoutingEntry[],
  role: AgentRole,
): RoutingEntry | null {
  return routingEntryFor(entries, AGENT_ROUTING_ROLE[role]);
}

export function routingModelForAgent(
  entries: readonly RoutingEntry[],
  role: AgentRole,
): string | null {
  const entry = routingEntryForAgent(entries, role);
  if (entry === null) return null;
  return role === "implementer"
    ? (entry.subagentModel ?? entry.model)
    : entry.model;
}

function mentions(value: string, needle: string): boolean {
  return value.toLowerCase().includes(needle);
}

export function isModelAllowedForRole(
  role: AgentRole,
  model: CatalogModelOption,
): boolean {
  const names = [model.id, model.displayName];
  if (names.some((name) => mentions(name, "haiku"))) return false;
  if (role !== "scout" && names.some((name) => mentions(name, "sonnet"))) {
    return false;
  }
  return true;
}

export function allowedModelsForRole<M extends CatalogModelOption>(
  role: AgentRole,
  catalog: readonly M[],
): M[] {
  return catalog.filter((model) => isModelAllowedForRole(role, model));
}

export function disallowedModelMessage(role: AgentRole, model: string): string {
  return (
    `Model ${model} is not allowed for ${role} by ROUTING.md: ` +
    "Haiku is never used, Sonnet only for scout"
  );
}

export function routingDrift(
  role: AgentRole,
  frontmatterModel: string,
  entries: readonly RoutingEntry[],
): string | null {
  const expected = routingModelForAgent(entries, role);
  if (expected === null || expected === frontmatterModel) return null;
  return expected;
}
