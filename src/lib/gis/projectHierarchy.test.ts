import assert from "node:assert/strict";
import test from "node:test";

import type { ProjectSummary } from "./project.ts";
import { isProjectDescendant, projectAncestorIds, projectDescendants } from "./projectHierarchy.ts";

const project = (id: string, parentProjectId: string | null = null): ProjectSummary => ({
  id,
  name: id,
  updatedAt: 0,
  autosave: true,
  versionCount: 1,
  parentProjectId,
  showInQuickSwitch: true,
  showInMobileBar: true,
});

test("project hierarchy returns nested descendants in display order", () => {
  const projects = [
    project("root"),
    project("child-a", "root"),
    project("grandchild", "child-a"),
    project("child-b", "root"),
    project("other"),
  ];

  assert.deepEqual(
    projectDescendants("root", projects).map(({ project: item, depth, path }) => ({
      id: item.id,
      depth,
      path: path.map((part) => part.id),
    })),
    [
      { id: "child-a", depth: 1, path: ["child-a"] },
      { id: "grandchild", depth: 2, path: ["child-a", "grandchild"] },
      { id: "child-b", depth: 1, path: ["child-b"] },
    ],
  );
  assert.deepEqual(projectAncestorIds("grandchild", projects), ["root", "child-a"]);
  assert.equal(isProjectDescendant("grandchild", "root", projects), true);
  assert.equal(isProjectDescendant("other", "root", projects), false);
});

test("project hierarchy stops safely when stored data contains a cycle", () => {
  const projects = [project("a", "c"), project("b", "a"), project("c", "b")];

  assert.deepEqual(projectAncestorIds("a", projects), ["b", "c"]);
  assert.deepEqual(
    projectDescendants("a", projects).map(({ project: item }) => item.id),
    ["b", "c"],
  );
});
