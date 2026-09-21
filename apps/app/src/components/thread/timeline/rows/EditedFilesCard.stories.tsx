import type { TimelineTurnEditedFile } from "@bb/server-contract";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import { conversationRow, turnRow } from "@/test/fixtures/thread-timeline-rows";
import { TurnEditedFilesCard } from "../TurnEditedFilesCard";
import { StoryCard, StoryRow } from "../../../../../.ladle/story-card";

type TurnEditedFile = TimelineTurnEditedFile;

export default {
  title: "thread/timeline/rows/Edited Files Card",
};

function TimelineStage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

function noop(): void {}

const FOUR_FILES: TurnEditedFile[] = [
  {
    path: "apps/app/src/components/thread/timeline/TurnEditedFilesCard.tsx",
    added: 103,
    removed: 0,
    kind: "created",
  },
  {
    path: "apps/app/src/components/thread/timeline/ThreadTimelineRows.tsx",
    added: 24,
    removed: 3,
    kind: "edited",
  },
  { path: "docs/timeline.md", added: 12, removed: 4, kind: "edited" },
  { path: "apps/app/package.json", added: 1, removed: 1, kind: "edited" },
];

const TWELVE_FILES: TurnEditedFile[] = Array.from(
  { length: 12 },
  (_, index) => ({
    path: `packages/thread-view/src/module-${index + 1}.ts`,
    added: (index + 1) * 3,
    removed: index,
    kind: "edited",
  }),
);

const LONG_PATH_FILES: TurnEditedFile[] = [
  {
    path: "packages/some-deeply-nested-package/src/features/timeline/components/rows/summaries/an-exceptionally-long-component-file-name-that-must-truncate.tsx",
    added: 48,
    removed: 17,
    kind: "edited",
  },
  {
    path: "apps/app/src/components/secondary-panel/git-diff/another-remarkably-verbose-helper-module-name-for-truncation.test.ts",
    added: 7,
    removed: 0,
    kind: "created",
  },
];

const DELETED_FILES: TurnEditedFile[] = [
  {
    path: "src/legacy/old-timeline.ts",
    added: 0,
    removed: 212,
    kind: "deleted",
  },
  { path: "src/legacy/README.md", added: 0, removed: 18, kind: "deleted" },
];

function CardStory({ files }: { files: readonly TurnEditedFile[] }) {
  return (
    <TimelineStage>
      <TurnEditedFilesCard
        files={files}
        onOpenFile={noop}
        onViewChanges={noop}
      />
    </TimelineStage>
  );
}

export function OneFile() {
  return (
    <StoryCard>
      <StoryRow label="1 file" hint="singular header">
        <CardStory files={FOUR_FILES.slice(0, 1)} />
      </StoryRow>
    </StoryCard>
  );
}

export function FourFiles() {
  return (
    <StoryCard>
      <StoryRow label="4 files" hint="code, markdown and json icons">
        <CardStory files={FOUR_FILES} />
      </StoryRow>
    </StoryCard>
  );
}

export function TwelveFiles() {
  return (
    <StoryCard>
      <StoryRow label="12 files" hint="collapsed to 8 rows with +4 more">
        <CardStory files={TWELVE_FILES} />
      </StoryRow>
    </StoryCard>
  );
}

export function LongPaths() {
  return (
    <StoryCard>
      <StoryRow
        label="long paths"
        hint="basename truncates, full path in title"
      >
        <CardStory files={LONG_PATH_FILES} />
      </StoryRow>
    </StoryCard>
  );
}

const TIMELINE_TURN_ID = "turn_edited_files_story";

const timelineRows = [
  conversationRow({
    id: "story_user",
    role: "user",
    text: "Add the edited files card.",
    turnId: TIMELINE_TURN_ID,
    sourceSeqStart: 1,
  }),
  turnRow({
    id: "story_turn",
    turnId: TIMELINE_TURN_ID,
    sourceSeqStart: 2,
    sourceSeqEnd: 9,
    summaryCount: 6,
    editedFiles: FOUR_FILES,
  }),
  conversationRow({
    id: "story_assistant",
    role: "assistant",
    text: "Added the card and wired it to the Task diff panel.",
    turnId: TIMELINE_TURN_ID,
    sourceSeqStart: 10,
  }),
];

export function InTimeline() {
  return (
    <StoryCard>
      <StoryRow
        label="in timeline"
        hint="read from the completed turn row's editedFiles"
      >
        <TimelineStage>
          <ThreadTimelineRows
            threadRuntimeDisplayStatus="idle"
            workspaceRootPath={undefined}
            timelineRows={timelineRows}
            onViewTurnChanges={noop}
          />
        </TimelineStage>
      </StoryRow>
    </StoryCard>
  );
}

export function DeletionsOnly() {
  return (
    <StoryCard>
      <StoryRow label="deletions only" hint="deleted files show only removed">
        <CardStory files={DELETED_FILES} />
      </StoryRow>
    </StoryCard>
  );
}
