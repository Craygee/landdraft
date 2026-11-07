import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROTATION_REMEASURE_DELAYS_MS, installViewportSync } from "../viewportSync.ts";

function fakeWindow(width: number, height: number) {
  const listeners = new Map<string, Set<() => void>>();
  const viewportListeners = new Map<string, Set<() => void>>();
  const add = (map: typeof listeners) => (name: string, listener: unknown) => {
    if (!map.has(name)) map.set(name, new Set());
    map.get(name)!.add(listener as () => void);
  };
  const remove = (map: typeof listeners) => (name: string, listener: unknown) => {
    map.get(name)?.delete(listener as () => void);
  };
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const scrolls: Array<[number, number]> = [];
  const target = {
    innerWidth: width,
    innerHeight: height,
    scrollX: 0,
    scrollY: 0,
    scrollTo: (x: number, y: number) => {
      scrolls.push([x, y]);
      target.scrollY = y;
    },
    addEventListener: add(listeners),
    removeEventListener: remove(listeners),
    setTimeout: (callback: () => void) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => {
      timers.delete(id);
    },
    visualViewport: {
      addEventListener: add(viewportListeners),
      removeEventListener: remove(viewportListeners),
    },
  };
  const values = new Map<string, string>();
  return {
    target: target as unknown as Parameters<typeof installViewportSync>[0],
    raw: target,
    values,
    style: { setProperty: (name: string, value: string) => void values.set(name, value) },
    timers,
    scrolls,
    fire: (name: string) => {
      for (const listener of listeners.get(name) ?? []) listener();
    },
    listenerCount: () =>
      [...listeners.values(), ...viewportListeners.values()].reduce((n, s) => n + s.size, 0),
  };
}

test("publishes the measured window size on install", () => {
  const win = fakeWindow(820, 1180);
  installViewportSync(win.target, win.style);
  assert.equal(win.values.get("--app-live-width"), "820px");
  assert.equal(win.values.get("--app-live-height"), "1180px");
  assert.equal(win.values.get("--app-viewport-height"), "1180px");
});

test("keeps measuring after a rotation until the late size arrives", () => {
  const win = fakeWindow(820, 1180);
  installViewportSync(win.target, win.style);
  win.fire("orientationchange");
  assert.equal(win.timers.size, ROTATION_REMEASURE_DELAYS_MS.length);
  // Safari has not reported the new size yet when the event fires.
  assert.equal(win.values.get("--app-live-width"), "820px");
  win.raw.innerWidth = 1180;
  win.raw.innerHeight = 820;
  for (const [id, callback] of [...win.timers]) {
    callback();
    win.timers.delete(id);
  }
  assert.equal(win.values.get("--app-live-width"), "1180px");
  assert.equal(win.values.get("--app-live-height"), "820px");
});

test("clears a document scroll left behind by a rotation", () => {
  const win = fakeWindow(1180, 820);
  installViewportSync(win.target, win.style);
  win.raw.scrollY = 180;
  win.fire("orientationchange");
  assert.deepEqual(win.scrolls, [[0, 0]]);
});

test("ignores an empty measurement", () => {
  const win = fakeWindow(820, 1180);
  installViewportSync(win.target, win.style);
  win.raw.innerWidth = 0;
  win.fire("resize");
  assert.equal(win.values.get("--app-live-width"), "820px");
});

test("removes its listeners and pending timers", () => {
  const win = fakeWindow(820, 1180);
  const remove = installViewportSync(win.target, win.style);
  win.fire("orientationchange");
  remove();
  assert.equal(win.listenerCount(), 0);
  assert.equal(win.timers.size, 0);
});

test("full-screen layouts use the measured size on screen only", () => {
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  const screen = /@media screen \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  assert.match(screen, /html,\s*body\s*\{[^}]*width:\s*var\(--app-live-width,\s*100%\)/);
  assert.match(screen, /html,\s*body\s*\{[^}]*height:\s*var\(--app-live-height,\s*100%\)/);
  assert.match(screen, /\.app-viewport\s*\{[^}]*width:\s*var\(--app-live-width,\s*auto\)/);
  assert.match(screen, /\.app-viewport\s*\{[^}]*height:\s*var\(--app-live-height,\s*auto\)/);
});
