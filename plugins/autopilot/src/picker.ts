export const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export interface CandidateTask {
  id: string;
  key: string;
  title: string;
  status: string;
  priority: string;
  position: number;
  projectId: string;
  labelIds: readonly string[];
}

export interface PickInput<T extends CandidateTask = CandidateTask> {
  tasks: readonly T[];
  trackedTaskIds: ReadonlySet<string>;
  skipTaskIds: ReadonlySet<string>;
  limit: number;
}

export function pickNext<T extends CandidateTask>(input: PickInput<T>): T[] {
  if (input.limit <= 0) return [];
  const seen = new Set<string>();
  return input.tasks
    .filter((task) => {
      if (task.status !== "todo") return false;
      if (input.trackedTaskIds.has(task.id)) return false;
      if (input.skipTaskIds.has(task.id)) return false;
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    })
    .sort((a, b) => {
      const rank =
        (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
      if (rank !== 0) return rank;
      if (a.position !== b.position) return a.position - b.position;
      return a.key.localeCompare(b.key);
    })
    .slice(0, input.limit);
}

export function isPlannerDescription(description: string): boolean {
  return /^\s*kind:\s*planner\s*$/imu.test(description);
}

export function acceptanceCommand(description: string): string | null {
  const match = /^\s*acceptance:\s*`?([^`\n]+?)`?\s*$/imu.exec(description);
  return match === null ? null : match[1]!.trim();
}

export function sourceRepos(sources: string): string[] {
  const repos: string[] = [];
  for (const line of sources.split("\n")) {
    const name = line.split(":")[0]?.trim() ?? "";
    if (name !== "" && !repos.includes(name)) repos.push(name);
  }
  return repos;
}

export function prefixFor(repo: string, taken: readonly string[]): string {
  const letters = repo.toUpperCase().replace(/[^A-Z0-9]/gu, "");
  let base = /^[A-Z]/u.test(letters) ? letters.slice(0, 6) : `P${letters}`.slice(0, 6);
  if (base === "") base = "AUTO";
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${base.slice(0, 8)}${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
  throw new Error(`No free prefix for ${repo}`);
}
