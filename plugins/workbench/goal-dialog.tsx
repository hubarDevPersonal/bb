import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Button } from "@bb/shared-ui/button";
import { Textarea } from "@bb/shared-ui/textarea";

export const GOAL_MAX_TASKS_MIN = 1;
export const GOAL_MAX_TASKS_MAX = 12;
export const GOAL_MAX_TASKS_DEFAULT = 6;

export interface GoalDialogViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: string;
  onGoalChange: (value: string) => void;
  maxTasks: number;
  onMaxTasksChange: (value: number) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: () => void;
}

export function GoalDialogView({
  open,
  onOpenChange,
  goal,
  onGoalChange,
  maxTasks,
  onMaxTasksChange,
  submitting,
  error,
  onSubmit,
}: GoalDialogViewProps) {
  const canSubmit = goal.trim().length > 0 && !submitting;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogTitle className="px-4 pt-4 text-sm font-medium text-foreground">
          Run goal workflow
        </DialogTitle>
        <DialogDescription className="px-4 pt-1 text-xs text-muted-foreground">
          Starts the goal workflow, which plans and delegates tasks toward your
          goal.
        </DialogDescription>
        <div className="space-y-3 px-4 pt-3">
          <div className="space-y-1">
            <label
              htmlFor="workbench-goal-text"
              className="text-xs font-medium text-subtle-foreground"
            >
              Goal
            </label>
            <Textarea
              id="workbench-goal-text"
              autoFocus
              value={goal}
              disabled={submitting}
              onChange={(event) => onGoalChange(event.target.value)}
              placeholder="Describe the outcome you want…"
              className="min-h-24 resize-y bg-background text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="workbench-goal-max-tasks"
              className="text-xs font-medium text-subtle-foreground"
            >
              Max tasks
            </label>
            <input
              id="workbench-goal-max-tasks"
              type="number"
              min={GOAL_MAX_TASKS_MIN}
              max={GOAL_MAX_TASKS_MAX}
              value={maxTasks}
              disabled={submitting}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10);
                if (Number.isNaN(parsed)) return;
                onMaxTasksChange(
                  Math.min(
                    GOAL_MAX_TASKS_MAX,
                    Math.max(GOAL_MAX_TASKS_MIN, parsed),
                  ),
                );
              }}
              className="h-7 w-20 rounded-md border border-border bg-transparent px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          {error !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="mt-4 border-t border-border-hairline px-4 py-3">
          <Button
            type="button"
            size="sm"
            disabled={!canSubmit}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onSubmit}
          >
            {submitting ? "Starting…" : "Run goal workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
