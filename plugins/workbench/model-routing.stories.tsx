import {
  ModelRoutingSectionView,
  type ModelOption,
  type ModelRoutingSectionViewProps,
  type ProviderOption,
} from "./model-routing.js";
import type { RoutingEntry } from "./routing.js";
import { StoryCard, StoryRow } from "../../apps/app/.ladle/story-card.js";

export default { title: "plugins/Workbench/Model routing" };

const MODELS: readonly ModelOption[] = [
  { id: "claude-haiku-4-5", displayName: "Haiku 4.5" },
  { id: "claude-sonnet-5", displayName: "Sonnet 5" },
  { id: "claude-opus-5", displayName: "Opus 5" },
  { id: "claude-fable-5-1", displayName: "Fable 5.1" },
];

const TWO_PROVIDERS: readonly ProviderOption[] = [
  { id: "claude-code", name: "Claude Code" },
  { id: "codex", name: "Codex" },
];

const ROUTING_ENTRIES: readonly RoutingEntry[] = [
  {
    role: "architect",
    providerId: "claude-code",
    model: "claude-fable-5-1",
    subagentModel: null,
    effort: "high",
  },
  {
    role: "implementer",
    providerId: "claude-code",
    model: "claude-opus-5[1m]",
    subagentModel: "claude-opus-5",
    effort: "high",
  },
  {
    role: "scout",
    providerId: "claude-code",
    model: "claude-sonnet-5",
    subagentModel: null,
    effort: "medium",
  },
  {
    role: "reviewer-cross-vendor",
    providerId: "codex",
    model: "gpt-5.6-sol",
    subagentModel: null,
    effort: "high",
  },
  {
    role: "reviewer-subagent",
    providerId: "claude-code",
    model: "claude-fable-5-1",
    subagentModel: null,
    effort: "high",
  },
];

const BASE: ModelRoutingSectionViewProps = {
  routing: { ok: true, entries: ROUTING_ENTRIES },
  rows: {
    implementer: { ok: true, model: "claude-opus-5", effort: "high" },
    scout: { ok: true, model: "claude-sonnet-5", effort: null },
    reviewer: { ok: true, model: "claude-fable-5-1", effort: "high" },
  },
  reviewTarget: {
    ok: true,
    providerId: "codex",
    providerName: "Codex",
    model: "gpt-5.6-sol",
    effort: "high",
    reasoningLevel: "high",
    source: "routing-cross-vendor",
  },
  reviewProvider: "auto",
  models: MODELS,
  providers: TWO_PROVIDERS,
  providerId: "claude-code",
  providerName: "Claude Code",
  saving: null,
  hostAvailable: true,
  onSave: () => undefined,
  onSaveEffort: () => undefined,
  onReviewProviderChange: () => undefined,
  onProviderChange: () => undefined,
};

export function AllRows() {
  return (
    <main className="mx-auto w-full max-w-3xl py-1">
      <StoryCard className="border border-border bg-card" labelWidth="190px">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">
            Model routing
          </h1>
        </div>
        <StoryRow
          label="Matches ROUTING.md"
          hint="Five roles: architect and cross-vendor reviewer from ROUTING.md, subagents from frontmatter."
        >
          <ModelRoutingSectionView {...BASE} />
        </StoryRow>
        <StoryRow
          label="Drift"
          hint="The reviewer's frontmatter model differs from ROUTING.md."
        >
          <ModelRoutingSectionView
            {...BASE}
            rows={{
              ...BASE.rows,
              reviewer: { ok: true, model: "claude-opus-5", effort: "high" },
            }}
          />
        </StoryRow>
        <StoryRow
          label="Disallowed current"
          hint="A Haiku frontmatter value stays visible but is marked and never offered."
        >
          <ModelRoutingSectionView
            {...BASE}
            rows={{
              ...BASE.rows,
              scout: { ok: true, model: "claude-haiku-4-5", effort: null },
            }}
          />
        </StoryRow>
        <StoryRow
          label="Saving"
          hint="A save request for implementer is in flight."
        >
          <ModelRoutingSectionView {...BASE} saving="implementer" />
        </StoryRow>
        <StoryRow
          label="Cross-vendor fallback"
          hint="Codex is unavailable, so the review falls back to the in-thread reviewer row."
        >
          <ModelRoutingSectionView
            {...BASE}
            providers={[{ id: "claude-code", name: "Claude Code" }]}
            reviewTarget={{
              ok: true,
              providerId: "claude-code",
              providerName: "Claude Code",
              model: "claude-fable-5-1",
              effort: "high",
              reasoningLevel: "high",
              source: "routing-subagent",
            }}
          />
        </StoryRow>
        <StoryRow
          label="Errors"
          hint="No ROUTING.md: typed agent-file errors show in place, and the review target depends on the thread."
        >
          <ModelRoutingSectionView
            {...BASE}
            routing={{ ok: false, error: "missing_file" }}
            rows={{
              implementer: { ok: false, error: "missing_model_key" },
              scout: { ok: false, error: "missing_file" },
              reviewer: { ok: true, model: "claude-fable-5-1", effort: null },
            }}
            reviewTarget={{ ok: false, error: "thread_dependent" }}
          />
        </StoryRow>
        <StoryRow
          label="No host"
          hint="No connected host to read ROUTING.md, agent files, or a model catalog from."
        >
          <ModelRoutingSectionView
            {...BASE}
            hostAvailable={false}
            routing={{ ok: false, error: "host_unavailable" }}
            models={[]}
            providers={[]}
            providerId={null}
            providerName={null}
            reviewProvider={null}
            reviewTarget={{ ok: false, error: "host_unavailable" }}
            rows={{
              implementer: { ok: false, error: "host_unavailable" },
              scout: { ok: false, error: "host_unavailable" },
              reviewer: { ok: false, error: "host_unavailable" },
            }}
          />
        </StoryRow>
      </StoryCard>
    </main>
  );
}
