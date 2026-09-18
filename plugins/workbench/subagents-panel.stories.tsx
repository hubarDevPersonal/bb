import { StoryCard, StoryRow } from "../../apps/app/.ladle/story-card.js";
import {
  SubagentsDoneCardView,
  SubagentsPanelView,
  type SubagentOutputView,
  type SubagentRowView,
} from "./subagents-panel.js";

export default { title: "plugins/Workbench/Subagents" };

const NOW = Date.parse("2026-09-18T12:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

const MIXED_SUBAGENTS: readonly SubagentRowView[] = [
  {
    id: "thr_a",
    title: "Investigate flaky test",
    status: "active",
    updatedAt: minutesAgo(2),
  },
  {
    id: "thr_b",
    title: "Migrate settings store",
    status: "active",
    updatedAt: minutesAgo(9),
  },
  {
    id: "thr_c",
    title: "Fix ENG-42 login bug",
    status: "done",
    updatedAt: minutesAgo(20),
  },
  {
    id: "thr_d",
    title: "Update changelog",
    status: "done",
    updatedAt: minutesAgo(140),
  },
  {
    id: "thr_e",
    title: "Add spec-check regression test",
    status: "done",
    updatedAt: minutesAgo(1_500),
  },
];

const MIXED_OUTPUTS: readonly SubagentOutputView[] = [
  { path: "apps/app/src/lib/relative-time.ts", environmentId: "env_1" },
  { path: "plugins/workbench/subagents-panel.tsx", environmentId: "env_1" },
  { path: "CHANGELOG.md", environmentId: "env_1" },
];

export function Panel() {
  return (
    <main className="mx-auto w-full max-w-3xl py-1">
      <StoryCard className="border border-border bg-card" labelWidth="190px">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">
            Subagents panel
          </h1>
        </div>
        <StoryRow
          label="Mixed active/done + outputs"
          hint="Two running subagents, three finished, and files created in this thread."
        >
          <div className="h-96 overflow-hidden rounded-md border border-border bg-background">
            <SubagentsPanelView
              now={NOW}
              subagents={MIXED_SUBAGENTS}
              outputs={MIXED_OUTPUTS}
              onSelectSubagent={() => undefined}
              onSelectOutput={() => undefined}
            />
          </div>
        </StoryRow>
        <StoryRow
          label="Empty"
          hint="No subagents delegated yet and no files created."
        >
          <div className="h-64 overflow-hidden rounded-md border border-border bg-background">
            <SubagentsPanelView
              now={NOW}
              subagents={[]}
              outputs={[]}
              onSelectSubagent={() => undefined}
              onSelectOutput={() => undefined}
            />
          </div>
        </StoryRow>
      </StoryCard>
    </main>
  );
}

export function DoneCard() {
  return (
    <main className="mx-auto w-full max-w-3xl py-1">
      <StoryCard className="border border-border bg-card" labelWidth="190px">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">
            Subagents done — composer card
          </h1>
        </div>
        <StoryRow label="3 done" hint="No subagents still running.">
          <div className="max-w-md">
            <SubagentsDoneCardView
              doneNames={[
                "Investigate flaky test",
                "Fix ENG-42 login bug",
                "Update changelog",
              ]}
              doneCount={3}
              activeCount={0}
              onView={() => undefined}
            />
          </div>
        </StoryRow>
        <StoryRow
          label="7 done, 2 active"
          hint="The avatar stack caps at four; the count still reads seven."
        >
          <div className="max-w-md">
            <SubagentsDoneCardView
              doneNames={[
                "Investigate flaky test",
                "Fix ENG-42 login bug",
                "Update changelog",
                "Add spec-check regression test",
                "Migrate settings store",
                "Rebase onto main",
                "Draft release notes",
              ]}
              doneCount={7}
              activeCount={2}
              onView={() => undefined}
            />
          </div>
        </StoryRow>
      </StoryCard>
    </main>
  );
}
