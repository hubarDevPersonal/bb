import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";
import {
  AGENT_EFFORT_LEVELS,
  allowedModelsForRole,
  isModelAllowedForRole,
  routingDrift,
  routingEntryFor,
  routingEntryForAgent,
  type AgentEffortLevel,
  type AgentRole,
  type RoutingEntry,
} from "./routing.js";
import { THREAD_DEPENDENT_REVIEW_MESSAGE } from "./review-target.js";

export type RoutingRoleId = AgentRole;

export type RoutingRowView =
  | { ok: true; model: string; effort: string | null }
  | { ok: false; error: string };

export type RoutingSourceView =
  | { ok: true; entries: readonly RoutingEntry[] }
  | { ok: false; error: string };

export type ReviewTargetView =
  | {
      ok: true;
      providerId: string;
      providerName: string;
      model: string;
      effort: string | null;
      reasoningLevel: string | null;
      source: string;
    }
  | { ok: false; error: string };

export type RoutingSavingId = RoutingRoleId | "review";

export interface ModelOption {
  id: string;
  displayName: string;
}

export interface ProviderOption {
  id: string;
  name: string;
}

export const ROUTING_ROLE_LABELS: Readonly<Record<RoutingRoleId, string>> = {
  scout: "Scout",
  implementer: "Implementer",
  reviewer: "Reviewer",
};

const AGENT_DISPLAY_ORDER: readonly RoutingRoleId[] = [
  "implementer",
  "scout",
  "reviewer",
];

const ROUTING_ERROR_COPY: Readonly<Record<string, string>> = {
  host_unavailable: "No connected host",
  missing_file: "Agent file not found",
  missing_frontmatter: "No frontmatter in agent file",
  missing_model_key: "No model key in frontmatter",
  call_failed: "Could not reach host",
  not_allowed: "Not allowed by ROUTING.md",
};

const ROUTING_SOURCE_ERROR_COPY: Readonly<Record<string, string>> = {
  host_unavailable: "No connected host",
  missing_file: "~/.claude/ROUTING.md not found",
  no_table: "~/.claude/ROUTING.md has no routing table",
  call_failed: "Could not reach host",
};

const REVIEW_ERROR_COPY: Readonly<Record<string, string>> = {
  host_unavailable: "No connected host",
  no_provider_available: "No available provider to review with",
  provider_unavailable: "Configured review provider is unavailable",
  no_environment: "This thread has no environment to review",
  review_of_review: "This thread is itself a cross-model review",
  thread_dependent: THREAD_DEPENDENT_REVIEW_MESSAGE,
};

export const REVIEW_SOURCE_COPY: Readonly<Record<string, string>> = {
  "routing-cross-vendor": "per ROUTING.md cross-vendor reviewer",
  "routing-subagent": "per ROUTING.md in-thread reviewer",
  routing: "ROUTING.md model for this provider",
  "provider-default": "provider default model",
  fallback: "fallback: first provider other than the thread's own",
};

function routingErrorText(error: string): string {
  return ROUTING_ERROR_COPY[error] ?? error;
}

function withEffort(text: string, effort: string | null): string {
  return effort === null ? text : `${text} · ${effort}`;
}

export function modelPickerState(
  role: RoutingRoleId,
  row: RoutingRowView,
  models: readonly ModelOption[],
): { options: readonly ModelOption[]; currentAllowed: boolean } {
  const options = allowedModelsForRole(role, models);
  if (!row.ok) return { options, currentAllowed: true };
  const current = models.find((model) => model.id === row.model) ?? {
    id: row.model,
    displayName: row.model,
  };
  const currentAllowed = isModelAllowedForRole(role, current);
  if (!currentAllowed || options.some((model) => model.id === row.model)) {
    return { options, currentAllowed };
  }
  return { options: [current, ...options], currentAllowed };
}

function withEffortInParens(text: string, effort: string | null): string {
  return effort === null ? text : `${text} (${effort})`;
}

export function multiModelSummaryRows(input: {
  routing: RoutingSourceView;
  rows: Readonly<Record<RoutingRoleId, RoutingRowView>>;
  reviewTarget: ReviewTargetView;
}): [string, string][] {
  const entries = input.routing.ok ? input.routing.entries : [];
  const architect = routingEntryFor(entries, "architect");
  const agent = (role: RoutingRoleId): string => {
    const row = input.rows[role];
    if (!row.ok) return routingErrorText(row.error);
    const entry = routingEntryForAgent(entries, role);
    const model =
      entry === null ? row.model : `${entry.providerId}/${row.model}`;
    return withEffortInParens(model, row.effort ?? entry?.effort ?? null);
  };
  const review = input.reviewTarget;
  return [
    [
      "Architect (this thread)",
      architect === null
        ? "not in ROUTING.md"
        : withEffortInParens(
            `${architect.providerId}/${architect.model}`,
            architect.effort,
          ),
    ],
    ["Implementer", agent("implementer")],
    ["Scout", agent("scout")],
    ["Reviewer subagent", agent("reviewer")],
    [
      "Cross-vendor review",
      review.ok
        ? withEffortInParens(
            `${review.providerId}/${review.model}`,
            review.reasoningLevel ?? review.effort,
          )
        : (REVIEW_ERROR_COPY[review.error] ?? review.error),
    ],
  ];
}

function RowLabel({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="w-28 shrink-0">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="text-xs break-words text-subtle-foreground">{detail}</p>
    </div>
  );
}

function ArchitectRow({ routing }: { routing: RoutingSourceView }) {
  const entry = routing.ok
    ? routingEntryFor(routing.entries, "architect")
    : null;
  return (
    <div className="flex min-h-9 items-start gap-2 px-2 py-1.5">
      <RowLabel label="Architect" detail="orchestrator thread" />
      <p className="min-w-0 flex-1 pt-0.5 text-xs text-foreground">
        {entry === null
          ? "Not in ROUTING.md"
          : withEffort(`${entry.providerId} / ${entry.model}`, entry.effort)}
      </p>
    </div>
  );
}

interface AgentRoutingRowProps {
  role: RoutingRoleId;
  row: RoutingRowView;
  entries: readonly RoutingEntry[];
  models: readonly ModelOption[];
  disabled: boolean;
  saving: boolean;
  onSave: (model: string) => void;
  onSaveEffort: (effort: AgentEffortLevel) => void;
}

function agentDetail(role: RoutingRoleId, entry: RoutingEntry | null): string {
  if (role === "implementer" && entry !== null) {
    return withEffort(`subagent · workflow: ${entry.model}`, entry.effort);
  }
  return withEffort("subagent", entry?.effort ?? null);
}

function isEffortLevel(value: string | null): value is AgentEffortLevel {
  return AGENT_EFFORT_LEVELS.some((level) => level === value);
}

function AgentRoutingRow({
  role,
  row,
  entries,
  models,
  disabled,
  saving,
  onSave,
  onSaveEffort,
}: AgentRoutingRowProps) {
  const { options, currentAllowed } = modelPickerState(role, row, models);
  const entry = routingEntryForAgent(entries, role);
  const drift = row.ok ? routingDrift(role, row.model, entries) : null;
  const selectedModel = row.ok && currentAllowed ? row.model : undefined;
  const effort = row.ok ? row.effort : null;
  const label = ROUTING_ROLE_LABELS[role];
  return (
    <div className="flex min-h-9 items-start gap-2 px-2 py-1.5">
      <RowLabel label={label} detail={agentDetail(role, entry)} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1">
          <Select
            value={selectedModel}
            disabled={disabled || saving || !row.ok || options.length === 0}
            onValueChange={(model) => {
              if (row.ok && model === row.model) return;
              onSave(model);
            }}
          >
            <SelectTrigger
              aria-label={`${label} model`}
              className="h-7 min-w-0 flex-1 text-xs"
            >
              <SelectValue
                placeholder={row.ok ? row.model : routingErrorText(row.error)}
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={isEffortLevel(effort) ? effort : undefined}
            disabled={disabled || saving || !row.ok}
            onValueChange={(next) => {
              if (next === effort || !isEffortLevel(next)) return;
              onSaveEffort(next);
            }}
          >
            <SelectTrigger
              aria-label={`${label} effort`}
              className="h-7 w-20 shrink-0 text-xs"
            >
              <SelectValue placeholder={effort ?? "Default"} />
            </SelectTrigger>
            <SelectContent>
              {AGENT_EFFORT_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {saving ? (
          <p className="text-xs text-subtle-foreground">Saving…</p>
        ) : null}
        {currentAllowed ? null : (
          <p className="text-xs text-attention">not allowed by ROUTING.md</p>
        )}
        {drift === null ? null : (
          <p className="text-xs text-attention">
            differs from ROUTING.md ({drift})
          </p>
        )}
      </div>
    </div>
  );
}

interface ReviewRoutingRowProps {
  target: ReviewTargetView;
  reviewProvider: string | null;
  providers: readonly ProviderOption[];
  disabled: boolean;
  saving: boolean;
  onChange: (value: string) => void;
}

function ReviewRoutingRow({
  target,
  reviewProvider,
  providers,
  disabled,
  saving,
  onChange,
}: ReviewRoutingRowProps) {
  return (
    <div className="flex min-h-9 items-start gap-2 px-2 py-1.5">
      <RowLabel label="Cross-vendor reviewer" detail="Review button" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-1">
          <p className="min-w-0 flex-1 truncate text-xs text-foreground">
            {target.ok
              ? withEffort(
                  `${target.providerName} · ${target.model}`,
                  target.reasoningLevel ?? target.effort,
                )
              : (REVIEW_ERROR_COPY[target.error] ?? target.error)}
          </p>
          <Select
            value={reviewProvider ?? undefined}
            disabled={disabled || saving || reviewProvider === null}
            onValueChange={onChange}
          >
            <SelectTrigger
              aria-label="Review provider"
              className="h-7 w-24 shrink-0 text-xs"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {target.ok ? (
          <p className="text-xs text-subtle-foreground">
            {REVIEW_SOURCE_COPY[target.source] ?? target.source}
          </p>
        ) : null}
        {saving ? (
          <p className="text-xs text-subtle-foreground">Saving…</p>
        ) : null}
      </div>
    </div>
  );
}

export interface ModelRoutingSectionViewProps {
  routing: RoutingSourceView;
  rows: Readonly<Record<RoutingRoleId, RoutingRowView>>;
  reviewTarget: ReviewTargetView;
  reviewProvider: string | null;
  models: readonly ModelOption[];
  providers: readonly ProviderOption[];
  providerId: string | null;
  providerName: string | null;
  saving: RoutingSavingId | null;
  hostAvailable: boolean;
  onSave: (role: RoutingRoleId, model: string) => void;
  onSaveEffort: (role: RoutingRoleId, effort: AgentEffortLevel) => void;
  onReviewProviderChange: (value: string) => void;
  onProviderChange: (providerId: string) => void;
}

export function ModelRoutingSectionView({
  routing,
  rows,
  reviewTarget,
  reviewProvider,
  models,
  providers,
  providerId,
  providerName,
  saving,
  hostAvailable,
  onSave,
  onSaveEffort,
  onReviewProviderChange,
  onProviderChange,
}: ModelRoutingSectionViewProps) {
  const entries = routing.ok ? routing.entries : [];
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 px-2">
        <h3 className="text-xs font-medium text-subtle-foreground">
          Model routing
        </h3>
        {providers.length > 1 ? (
          <Select
            value={providerId ?? undefined}
            onValueChange={onProviderChange}
          >
            <SelectTrigger
              aria-label="Provider"
              className="h-6 w-auto min-w-0 gap-1 border-none bg-transparent px-1 text-xs text-subtle-foreground"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {routing.ok ? null : (
        <p className="px-2 text-xs text-attention">
          {ROUTING_SOURCE_ERROR_COPY[routing.error] ?? routing.error}
        </p>
      )}
      <div className="rounded-md bg-surface-raised">
        <ArchitectRow routing={routing} />
        {AGENT_DISPLAY_ORDER.map((role) => (
          <AgentRoutingRow
            key={role}
            role={role}
            row={rows[role]}
            entries={entries}
            models={models}
            disabled={!hostAvailable}
            saving={saving === role}
            onSave={(model) => onSave(role, model)}
            onSaveEffort={(effort) => onSaveEffort(role, effort)}
          />
        ))}
        <ReviewRoutingRow
          target={reviewTarget}
          reviewProvider={reviewProvider}
          providers={providers}
          disabled={!hostAvailable}
          saving={saving === "review"}
          onChange={onReviewProviderChange}
        />
      </div>
      <p className="px-2 text-xs text-subtle-foreground">
        Architect and the cross-vendor reviewer follow{" "}
        <code>~/.claude/ROUTING.md</code>; subagent rows read and write the{" "}
        <code>model:</code> and <code>effort:</code> frontmatter keys in{" "}
        <code>~/.claude/agents/&lt;role&gt;.md</code> on the host
        {providerName === null ? "" : ` — models from ${providerName}`}. Haiku
        is never offered; Sonnet only for Scout.
      </p>
    </div>
  );
}
