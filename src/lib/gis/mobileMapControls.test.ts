import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Returns each rule's enclosing at-rules, so a test can see what gates a selector. */
function enclosingAtRules(selector: string) {
  const found: string[][] = [];
  const stack: string[] = [];
  let prelude = "";
  for (const character of css) {
    if (character === "{") {
      const text = prelude.trim();
      if (text.split(",").some((part) => part.trim() === selector)) found.push([...stack]);
      stack.push(text);
      prelude = "";
    } else if (character === "}") {
      stack.pop();
      prelude = "";
    } else if (character === ";") {
      prelude = "";
    } else {
      prelude += character;
    }
  }
  return found;
}

const widthGate = /(?:max|min)-width/;

for (const selector of [
  ".mobile-map-mode .maplibregl-ctrl-bottom-right",
  ".mobile-map-mode .maplibregl-ctrl-bottom-left",
  ".mobile-map-mode .landdraft-map-lock-controls",
  ".mobile-map-mode.mobile-has-selection .maplibregl-ctrl-bottom-right",
  ".mobile-map-mode.mobile-has-selection .landdraft-map-lock-controls",
]) {
  test(`keeps ${selector} above the bottom menu at every width`, () => {
    const rules = enclosingAtRules(selector);
    assert.ok(rules.length > 0, "rule is missing");
    for (const atRules of rules) {
      assert.equal(atRules.filter((atRule) => widthGate.test(atRule)).length, 0);
    }
  });
}

test("lifts the map controls at least as high as the bottom menu reaches", () => {
  // MobileWorkbench's nav is h-14 (3.5rem) plus a .5rem gap, topping out at 4rem.
  const block = /\.mobile-map-mode \.maplibregl-ctrl-bottom-left\s*\{([^}]*)\}/.exec(css)?.[1];
  const rem = Number(/bottom:\s*calc\(([\d.]+)rem/.exec(block ?? "")?.[1]);
  assert.ok(rem >= 4, `controls sit ${rem}rem above the viewport edge`);
});
