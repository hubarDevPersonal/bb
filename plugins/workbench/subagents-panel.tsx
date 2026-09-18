import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

export const SUBAGENT_PALETTE_COLORS = [
  "blue",
  "green",
  "orange",
  "purple",
  "yellow",
  "pink",
] as const;
export type SubagentPaletteColor = (typeof SUBAGENT_PALETTE_COLORS)[number];

const PALETTE_BG_CLASS: Readonly<Record<SubagentPaletteColor, string>> = {
  blue: "bg-palette-blue",
  green: "bg-palette-green",
  orange: "bg-palette-orange",
  purple: "bg-palette-purple",
  yellow: "bg-palette-yellow",
  pink: "bg-palette-pink",
};

export function paletteColorForName(name: string): SubagentPaletteColor {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return SUBAGENT_PALETTE_COLORS[
    (hash >>> 0) % SUBAGENT_PALETTE_COLORS.length
  ]!;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export function formatSubagentRelativeTime(
  timestamp: number,
  now: number,
): string {
  const diffMs = Math.max(0, now - timestamp);
  if (diffMs < MINUTE_MS) return "now";
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h`;
  if (diffMs < WEEK_MS) return `${Math.floor(diffMs / DAY_MS)}d`;
  return `${Math.floor(diffMs / WEEK_MS)}w`;
}

export interface SubagentRowView {
  id: string;
  title: string;
  status: "active" | "done";
  updatedAt: string;
}

export interface SubagentOutputView {
  path: string;
  environmentId: string;
}

function SubagentAvatar({
  name,
  className,
}: {
  name: string;
  className: string;
}) {
  const color = paletteColorForName(name);
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full text-2xs font-medium text-background",
        PALETTE_BG_CLASS[color],
        className,
      )}
    >
      {initial}
    </span>
  );
}

function SubagentPanelRow({
  subagent,
  now,
  onSelect,
}: {
  subagent: SubagentRowView;
  now: number;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(subagent.id)}
      className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-state-hover"
    >
      <SubagentAvatar name={subagent.title} className="size-5" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {subagent.title}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
        {formatSubagentRelativeTime(Date.parse(subagent.updatedAt), now)}
      </span>
    </button>
  );
}

function splitOutputPath(path: string): { dir: string; base: string } {
  const index = path.lastIndexOf("/");
  if (index === -1) return { dir: "", base: path };
  return { dir: path.slice(0, index), base: path.slice(index + 1) };
}

function OutputRow({
  output,
  onSelect,
}: {
  output: SubagentOutputView;
  onSelect: (output: SubagentOutputView) => void;
}) {
  const { dir, base } = splitOutputPath(output.path);
  return (
    <button
      type="button"
      onClick={() => onSelect(output)}
      className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-state-hover"
    >
      <Icon
        name="FileText"
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {base}
        {dir === "" ? null : (
          <span className="ml-1.5 text-xs text-subtle-foreground">{dir}</span>
        )}
      </span>
    </button>
  );
}

export interface SubagentsPanelViewProps {
  now: number;
  subagents: readonly SubagentRowView[];
  outputs: readonly SubagentOutputView[];
  onSelectSubagent: (id: string) => void;
  onSelectOutput: (output: SubagentOutputView) => void;
}

export function SubagentsPanelView({
  now,
  subagents,
  outputs,
  onSelectSubagent,
  onSelectOutput,
}: SubagentsPanelViewProps) {
  const active = subagents.filter((subagent) => subagent.status === "active");
  const done = subagents.filter((subagent) => subagent.status === "done");
  return (
    <div className="h-full min-h-0 space-y-4 overflow-y-auto p-3">
      <section aria-label="Subagents">
        {subagents.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">No subagents yet</p>
        ) : (
          <div className="space-y-3">
            {active.length === 0 ? null : (
              <div>
                <h3 className="px-2 pb-1 text-xs text-subtle-foreground">
                  Active · {active.length}
                </h3>
                {active.map((subagent) => (
                  <SubagentPanelRow
                    key={subagent.id}
                    subagent={subagent}
                    now={now}
                    onSelect={onSelectSubagent}
                  />
                ))}
              </div>
            )}
            {done.length === 0 ? null : (
              <div>
                <h3 className="px-2 pb-1 text-xs text-subtle-foreground">
                  Done · {done.length}
                </h3>
                {done.map((subagent) => (
                  <SubagentPanelRow
                    key={subagent.id}
                    subagent={subagent}
                    now={now}
                    onSelect={onSelectSubagent}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>
      <section aria-label="Outputs">
        <h3 className="px-2 pb-1 text-xs text-subtle-foreground">Outputs</h3>
        {outputs.length === 0 ? (
          <p className="px-2 text-sm text-muted-foreground">
            No files created yet
          </p>
        ) : (
          <div>
            {outputs.map((output) => (
              <OutputRow
                key={output.path}
                output={output}
                onSelect={onSelectOutput}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export interface SubagentsDoneCardViewProps {
  doneNames: readonly string[];
  doneCount: number;
  activeCount: number;
  onView: () => void;
}

export function SubagentsDoneCardView({
  doneNames,
  doneCount,
  activeCount,
  onView,
}: SubagentsDoneCardViewProps) {
  const stack = doneNames.slice(0, 4);
  return (
    <section
      aria-label="Subagents done"
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised-solid px-3 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex items-center">
          {stack.map((name, index) => (
            <span
              key={`${name}-${index}`}
              className={cn(
                "rounded-full ring-2 ring-background",
                index > 0 && "-ml-1.5",
              )}
            >
              <SubagentAvatar name={name} className="size-6" />
            </span>
          ))}
        </div>
        <p className="truncate text-sm text-foreground">
          {doneCount} subagent{doneCount === 1 ? "" : "s"} done
          {activeCount > 0 ? ` · ${activeCount} active` : ""}
        </p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onView}>
        View
      </Button>
    </section>
  );
}
