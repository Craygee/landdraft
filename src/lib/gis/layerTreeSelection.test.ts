import test from "node:test";
import assert from "node:assert/strict";
import { layerTreeIds, toggleLayerTreeSelection } from "./layerTreeSelection.ts";
const layers = [
  { id: "parent", groupId: "root" },
  { id: "child", groupId: "container" },
  { id: "nested", groupId: "nested-group" },
  { id: "grandchild", groupId: "child-container" },
  { id: "unrelated", groupId: "root" },
];
const groups = [
  { id: "root", name: "Root", collapsed: false },
  { id: "container", name: "Parent layers", containerLayerId: "parent", collapsed: true },
  { id: "nested-group", name: "Subgroup", parentId: "container", collapsed: true },
  { id: "child-container", name: "Child layers", containerLayerId: "child", collapsed: true },
];
test("parent selection includes nested layers and subgroup contents without selecting unrelated siblings", () => {
  assert.deepEqual(layerTreeIds("parent", layers, groups), [
    "parent",
    "child",
    "nested",
    "grandchild",
  ]);
  assert.deepEqual(toggleLayerTreeSelection("parent", false, ["unrelated"], layers, groups), [
    "parent",
    "child",
    "nested",
    "grandchild",
  ]);
});
test("batch checkbox adds and removes a complete branch while preserving unrelated selection", () => {
  const selected = toggleLayerTreeSelection("parent", true, ["unrelated"], layers, groups);
  assert.deepEqual(new Set(selected), new Set(layers.map((layer) => layer.id)));
  assert.deepEqual(toggleLayerTreeSelection("parent", true, selected, layers, groups), [
    "unrelated",
  ]);
});
test("partially checked branch selects all on next click; individual children remain independently selectable", () => {
  const all = toggleLayerTreeSelection(
    "parent",
    true,
    ["parent", "child", "unrelated"],
    layers,
    groups,
  );
  assert.equal(all.length, 5);
  const partial = toggleLayerTreeSelection("nested", true, all, layers, groups);
  assert.ok(!partial.includes("nested"));
  assert.ok(partial.includes("parent"));
  assert.equal(toggleLayerTreeSelection("parent", true, partial, layers, groups).length, 5);
});
test("nested parent selects only its own descendants and leaves retain normal selection", () => {
  assert.deepEqual(layerTreeIds("child", layers, groups), ["child", "grandchild"]);
  assert.deepEqual(toggleLayerTreeSelection("unrelated", false, [], layers, groups), ["unrelated"]);
  assert.deepEqual(toggleLayerTreeSelection("unrelated", true, ["unrelated"], layers, groups), []);
});
test("missing IDs and malformed cyclic containers terminate safely with no duplicates", () => {
  assert.deepEqual(layerTreeIds("missing", layers, groups), []);
  assert.deepEqual(toggleLayerTreeSelection("missing", true, ["unrelated"], layers, groups), [
    "unrelated",
  ]);
  const cyclic = [
    ...groups,
    {
      id: "loop",
      parentId: "child-container",
      containerLayerId: "parent",
      name: "Loop",
      collapsed: false,
    },
    { id: "child-container", parentId: "loop", name: "Duplicate", collapsed: false },
  ];
  const ids = layerTreeIds("parent", layers, cyclic);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, ids.length);
});
