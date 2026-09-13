import type { AppFixedTabDestination } from "@/lib/app-fixed-tab-navigation";
import type { AppFixedTabReference } from "@/lib/app-navigation-host";

export const TASK_DIFF_FIXED_TAB_REFERENCE: AppFixedTabReference = {
  ownerId: "core:task-diff",
  tabId: "task-diff",
};

export function createTaskDiffFixedTabDestination({
  eligible,
  open,
}: {
  eligible: boolean;
  open: () => void;
}): AppFixedTabDestination {
  return {
    tab: TASK_DIFF_FIXED_TAB_REFERENCE,
    open(target) {
      if (!eligible || target !== undefined) return false;
      open();
      return true;
    },
  };
}
