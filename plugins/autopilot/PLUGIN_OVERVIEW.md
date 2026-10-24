Hand bb a queue of small, testable tasks and let it work through them on its own — without burning the limits you need for your own work. When the five-hour window runs low, autopilot parks its threads and wakes them up after the reset.

## What you get

- A queue: every `todo` task with the `auto` label in any Tasks project.
- A worker per task (Tasks preset "Autopilot worker") that branches, implements, runs the task's `Acceptance:` command, opens a PR and moves the task to review.
- An independent verifier (preset "Autopilot verifier") that re-runs the checks from a clean state, reviews the diff, and merges only when everything is green — otherwise it sends the task back with the failing output. After three failed attempts the task returns to backlog with a comment for you.
- A budget: autopilot uses at most 60% of the five-hour window and 70% of the weekly window (configurable). Your own threads are never held.
- Revival: over budget, any message to an autopilot thread is queued until the window resets; core sends it then, so the work continues by itself, across restarts. A turn that runs far past the budget (hard-stop margin, default +15%) is stopped and parked the same way.
- A planner: when the queue runs dry, autopilot creates a planner task that turns the next roadmap items into new `auto` tasks (set *Planner tracker project prefix*).

## How it works

A five-minute schedule drives tracked tasks through work → verify → done and starts new ones while there is a free slot and budget. A `message.dispatch` hook gates only threads autopilot started: over budget it answers `wait` with `sendAt` at the window reset. Usage comes from `bb.sdk.system.usageLimits`, cached for a minute.

## For agents

`bb autopilot status | budget <provider> | tick | pause | resume | unskip <task-id> | setup [--provider --model]`. Run `bb autopilot setup` once to create the presets and the `auto` label in every Tasks project.
