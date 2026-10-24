---
name: autopilot
description: "Queue work for bb Autopilot and read its state: auto-labelled tasks, budget, parked threads, verifier results."
---

# Autopilot

Autopilot runs `todo` tasks labelled `auto` (any Tasks project) on its own:
worker → independent verifier → merge, within a share of the usage limits.

## Writing a task autopilot can finish

- One outcome, about 1–2 hours of agent work.
- A description line `Acceptance: <one command from the repo root>` that
  fails before the change and passes after it.
- A `Scope:` line naming the files or directories expected to change.
- Nothing that needs credentials, money, live trading, or messages to people:
  autopilot refuses those and returns the task to backlog.

Create with `bb tasks create --label auto --status todo …`.

## Inspecting

- `bb autopilot status` — tracked tasks, phase, attempt, recent events.
- `bb autopilot budget <provider-id>` — whether it may spend right now.
- A parked or deferred thread has a queued row waiting on the plugin:
  `bb thread queue list <thread-id>` shows when it resumes. Sending it now
  is the user's override; do not do it on their behalf.
- `bb autopilot pause` / `resume`, `bb autopilot unskip <task-id>` after
  fixing a task it gave up on.
