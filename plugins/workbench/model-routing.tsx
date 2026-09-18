import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bb/shared-ui/select";

export type RoutingRoleId = "scout" | "implementer" | "reviewer";

export type RoutingRowView =
  | { ok: true; model: string }
  | { ok: false; error: string };

export interface ModelOption {
  id: string;
  displayName: string;
}

export const ROUTING_ROLE_LABELS: Readonly<Record<RoutingRoleId, string>> = {
  scout: "Scout",
  implementer: "Implementer",
  reviewer: "Reviewer",
};

const ROUTING_ERROR_COPY: Readonly<Record<string, string>> = {
  host_unavailable: "No connected host",
  missing_file: "Agent file not found",
  missing_frontmatter: "No frontmatter in agent file",
  missing_model_key: "No model key in frontmatter",
  call_failed: "Could not reach host",
};

function routingErrorText(error: string): string {
  return ROUTING_ERROR_COPY[error] ?? error;
}

function rowOptions(
  row: RoutingRowView,
  models: readonly ModelOption[],
): readonly ModelOption[] {
  if (!row.ok) return models;
  if (models.some((model) => model.id === row.model)) return models;
  return [{ id: row.model, displayName: row.model }, ...models];
}

interface ModelRoutingRowProps {
  role: RoutingRoleId;
  row: RoutingRowView;
  models: readonly ModelOption[];
  disabled: boolean;
  saving: boolean;
  onSave: (model: string) => void;
}

function ModelRoutingRow({
  role,
  row,
  models,
  disabled,
  saving,
  onSave,
}: ModelRoutingRowProps) {
  const options = rowOptions(row, models);
  return (
    <div className="flex min-h-9 items-center gap-2 px-2 py-1">
      <span className="w-24 shrink-0 text-sm font-medium text-foreground">
        {ROUTING_ROLE_LABELS[role]}
      </span>
      <Select
        value={row.ok ? row.model : undefined}
        disabled={disabled || saving || !row.ok || options.length === 0}
        onValueChange={(model) => {
          if (row.ok && model === row.model) return;
          onSave(model);
        }}
      >
        <SelectTrigger
          aria-label={`${ROUTING_ROLE_LABELS[role]} model`}
          className="h-7 flex-1 text-xs"
        >
          <SelectValue
            placeholder={row.ok ? undefined : routingErrorText(row.error)}
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
      {saving ? (
        <span className="shrink-0 text-xs text-subtle-foreground">Saving…</span>
      ) : null}
    </div>
  );
}

export interface ModelRoutingSectionViewProps {
  rows: Readonly<Record<RoutingRoleId, RoutingRowView>>;
  models: readonly ModelOption[];
  providerName: string | null;
  savingRole: RoutingRoleId | null;
  hostAvailable: boolean;
  onSave: (role: RoutingRoleId, model: string) => void;
}

export function ModelRoutingSectionView({
  rows,
  models,
  providerName,
  savingRole,
  hostAvailable,
  onSave,
}: ModelRoutingSectionViewProps) {
  return (
    <div className="space-y-1">
      <h3 className="px-2 text-xs font-medium text-subtle-foreground">
        Model routing
      </h3>
      <div className="rounded-md bg-surface-raised">
        {(Object.keys(rows) as RoutingRoleId[]).map((role) => (
          <ModelRoutingRow
            key={role}
            role={role}
            row={rows[role]}
            models={models}
            disabled={!hostAvailable}
            saving={savingRole === role}
            onSave={(model) => onSave(role, model)}
          />
        ))}
      </div>
      <p className="px-2 text-xs text-subtle-foreground">
        Reads and writes the <code>model:</code> frontmatter key in each role's{" "}
        <code>~/.claude/agents/&lt;role&gt;.md</code> on the host
        {providerName === null ? "" : ` — models from ${providerName}`}.
      </p>
    </div>
  );
}
