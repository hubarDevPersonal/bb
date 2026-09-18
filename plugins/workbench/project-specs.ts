const PROJECT_SPEC_RELATIVE_PATH = ".claude/specs/PROJECT.md";

export interface ProjectSourceLike {
  type: string;
  hostId: string;
  path: string;
}

export interface ProjectLike {
  id: string;
  name: string;
  sources: readonly ProjectSourceLike[];
}

export interface ProjectSpecCandidate {
  projectId: string;
  projectName: string;
  hostId: string;
  rootPath: string;
  path: string;
}

function projectRootPath(source: ProjectSourceLike): string | null {
  if (source.type !== "local_path") return null;
  const trimmed = source.path.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

export function projectSpecCandidates(
  projects: readonly ProjectLike[],
  connectedHostIds: ReadonlySet<string>,
): ProjectSpecCandidate[] {
  const candidates: ProjectSpecCandidate[] = [];
  for (const project of projects) {
    for (const source of project.sources) {
      if (!connectedHostIds.has(source.hostId)) continue;
      const rootPath = projectRootPath(source);
      if (rootPath === null) continue;
      candidates.push({
        projectId: project.id,
        projectName: project.name,
        hostId: source.hostId,
        rootPath,
        path: `${rootPath}/${PROJECT_SPEC_RELATIVE_PATH}`,
      });
    }
  }
  return candidates;
}
