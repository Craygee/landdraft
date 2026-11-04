import type { ProjectSummary } from "./project";

export interface ProjectDescendant {
  project: ProjectSummary;
  depth: number;
  path: ProjectSummary[];
}

export function projectAncestorIds(projectId: string, projects: ProjectSummary[]): string[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const ancestors: string[] = [];
  const visited = new Set<string>([projectId]);
  let current = byId.get(projectId);

  while (current?.parentProjectId && !visited.has(current.parentProjectId)) {
    visited.add(current.parentProjectId);
    ancestors.unshift(current.parentProjectId);
    current = byId.get(current.parentProjectId);
  }

  return ancestors;
}

export function isProjectDescendant(
  projectId: string,
  ancestorId: string,
  projects: ProjectSummary[],
): boolean {
  return projectAncestorIds(projectId, projects).includes(ancestorId);
}

export function projectDescendants(
  ancestorId: string,
  projects: ProjectSummary[],
): ProjectDescendant[] {
  const children = new Map<string, ProjectSummary[]>();
  for (const project of projects) {
    if (!project.parentProjectId) continue;
    children.set(project.parentProjectId, [
      ...(children.get(project.parentProjectId) ?? []),
      project,
    ]);
  }

  const descendants: ProjectDescendant[] = [];
  const visited = new Set<string>([ancestorId]);
  const visit = (parentId: string, depth: number, path: ProjectSummary[]) => {
    for (const project of children.get(parentId) ?? []) {
      if (visited.has(project.id)) continue;
      visited.add(project.id);
      const nextPath = [...path, project];
      descendants.push({ project, depth, path: nextPath });
      visit(project.id, depth + 1, nextPath);
    }
  };

  visit(ancestorId, 1, []);
  return descendants;
}
