import type { PluginThreadActionsInlineItem } from "@get-bb/plugin-sdk";
import type { ThreadTaskActionsState } from "./useThreadTaskActions";

export function buildThreadTaskResponsiveActions(
  taskActions: ThreadTaskActionsState,
  group: string,
): PluginThreadActionsInlineItem[] {
  return [
    ...(taskActions.canReview
      ? [
          {
            key: "task/review",
            group,
            action: {
              icon: "Eye" as const,
              label: "Review",
              run: taskActions.review,
            },
          },
        ]
      : []),
    ...(taskActions.canApply
      ? [
          {
            key: "task/apply",
            group,
            action: {
              icon: "GitMerge" as const,
              label: "Apply changes locally",
              run: taskActions.apply,
            },
          },
        ]
      : []),
  ];
}
