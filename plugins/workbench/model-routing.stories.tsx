import { ModelRoutingSectionView, type ModelOption } from "./model-routing.js";
import { StoryCard, StoryRow } from "../../apps/app/.ladle/story-card.js";

export default { title: "plugins/Workbench/Model routing" };

const MODELS: readonly ModelOption[] = [
  { id: "haiku", displayName: "Haiku" },
  { id: "sonnet", displayName: "Sonnet" },
  { id: "opus", displayName: "Opus" },
];

export function AllRows() {
  return (
    <main className="mx-auto w-full max-w-3xl py-1">
      <StoryCard className="border border-border bg-card" labelWidth="190px">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">
            Model routing
          </h1>
        </div>
        <StoryRow label="Resolved" hint="Every role has a model on the host.">
          <ModelRoutingSectionView
            hostAvailable
            savingRole={null}
            models={MODELS}
            providerName="Claude Code"
            rows={{
              scout: { ok: true, model: "haiku" },
              implementer: { ok: true, model: "sonnet" },
              reviewer: { ok: true, model: "opus" },
            }}
            onSave={() => undefined}
          />
        </StoryRow>
        <StoryRow
          label="Saving"
          hint="A save request for implementer is in flight."
        >
          <ModelRoutingSectionView
            hostAvailable
            savingRole="implementer"
            models={MODELS}
            providerName="Claude Code"
            rows={{
              scout: { ok: true, model: "haiku" },
              implementer: { ok: true, model: "sonnet" },
              reviewer: { ok: true, model: "opus" },
            }}
            onSave={() => undefined}
          />
        </StoryRow>
        <StoryRow
          label="Alias not in catalog"
          hint="The raw frontmatter value stays selectable even when the live catalog doesn't list it."
        >
          <ModelRoutingSectionView
            hostAvailable
            savingRole={null}
            models={MODELS}
            providerName="Claude Code"
            rows={{
              scout: { ok: true, model: "claude-legacy-alias" },
              implementer: { ok: true, model: "sonnet" },
              reviewer: { ok: true, model: "opus" },
            }}
            onSave={() => undefined}
          />
        </StoryRow>
        <StoryRow
          label="Errors"
          hint="Typed errors show in place of the model."
        >
          <ModelRoutingSectionView
            hostAvailable
            savingRole={null}
            models={MODELS}
            providerName="Claude Code"
            rows={{
              scout: { ok: false, error: "missing_file" },
              implementer: { ok: false, error: "missing_model_key" },
              reviewer: { ok: true, model: "opus" },
            }}
            onSave={() => undefined}
          />
        </StoryRow>
        <StoryRow
          label="No host"
          hint="No connected host to read agent files or resolve a model catalog from."
        >
          <ModelRoutingSectionView
            hostAvailable={false}
            savingRole={null}
            models={[]}
            providerName={null}
            rows={{
              scout: { ok: false, error: "host_unavailable" },
              implementer: { ok: false, error: "host_unavailable" },
              reviewer: { ok: false, error: "host_unavailable" },
            }}
            onSave={() => undefined}
          />
        </StoryRow>
      </StoryCard>
    </main>
  );
}
