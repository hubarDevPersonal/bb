import type { ThreadActionsMenuResponsiveAction } from "@/components/thread/ThreadActionsMenu";
import type { ThreadTaskActionsState } from "./useThreadTaskActions";

export function buildThreadTaskResponsiveActions(
  taskActions: ThreadTaskActionsState,
): ThreadActionsMenuResponsiveAction[] {
  return [
    ...(taskActions.canReview
      ? [
          {
            icon: "Eye" as const,
            label: "Review",
            onSelect: taskActions.review,
          },
        ]
      : []),
    ...(taskActions.canApply
      ? [
          {
            icon: "GitMerge" as const,
            label: "Apply changes locally",
            onSelect: taskActions.apply,
          },
        ]
      : []),
  ];
}
