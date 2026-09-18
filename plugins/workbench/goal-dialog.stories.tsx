import { useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { GoalDialogView, GOAL_MAX_TASKS_DEFAULT } from "./goal-dialog.js";

export default { title: "plugins/Workbench/Goal dialog" };

function GoalDialogStory({ initialError }: { initialError: string | null }) {
  const [open, setOpen] = useState(true);
  const [goal, setGoal] = useState("Ship the notch-bridge integration");
  const [maxTasks, setMaxTasks] = useState(GOAL_MAX_TASKS_DEFAULT);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        Open goal dialog
      </Button>
      <GoalDialogView
        open={open}
        onOpenChange={setOpen}
        goal={goal}
        onGoalChange={setGoal}
        maxTasks={maxTasks}
        onMaxTasksChange={setMaxTasks}
        submitting={false}
        error={initialError}
        onSubmit={() => undefined}
      />
    </>
  );
}

export function Default() {
  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <h1 className="text-sm font-semibold text-foreground">Goal dialog</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Sends a message asking the agent to run the goal workflow.
      </p>
      <div className="mt-4">
        <GoalDialogStory initialError={null} />
      </div>
    </main>
  );
}

export function WithError() {
  return (
    <main className="mx-auto w-full max-w-3xl p-6">
      <div className="mt-4">
        <GoalDialogStory initialError="Could not queue the message." />
      </div>
    </main>
  );
}
