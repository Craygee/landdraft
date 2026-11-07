import test from "node:test";
import assert from "node:assert/strict";
import { installTestSiteTitle, isTestSiteHost, testSiteTitle } from "../testSiteTitle.ts";

function fakeDocument(title: string) {
  let callback: (() => void) | undefined;
  let observing = false;
  const doc = { title, head: {} as Node };
  const createObserver = (cb: () => void) => {
    callback = cb;
    return {
      observe: () => void (observing = true),
      disconnect: () => void (observing = false),
    };
  };
  return {
    doc,
    createObserver,
    /** Simulates the router replacing the <title> on navigation. */
    navigate: (next: string) => {
      doc.title = next;
      if (observing) callback?.();
    },
    isObserving: () => observing,
  };
}

test("recognises only the landdraft-test Worker host", () => {
  assert.equal(isTestSiteHost("landdraft-test.tight-sky-0ae1.workers.dev"), true);
  assert.equal(isTestSiteHost("landdraft.net"), false);
  assert.equal(isTestSiteHost("www.landdraft.net"), false);
  assert.equal(isTestSiteHost("localhost"), false);
  assert.equal(isTestSiteHost("landdraft.tight-sky-0ae1.workers.dev"), false);
  assert.equal(isTestSiteHost("landdraft-test.example.com"), false);
  assert.equal(isTestSiteHost("evil.landdraft-test.tight-sky-0ae1.workers.dev"), false);
});

test("adds the prefix once", () => {
  assert.equal(testSiteTitle("LandDraft"), "Test-LandDraft");
  assert.equal(testSiteTitle("Test-LandDraft"), "Test-LandDraft");
});

test("prefixes the title on the test site and after navigation", () => {
  const page = fakeDocument("LandDraft — Friendly Maps, Real GIS Power");
  const cleanup = installTestSiteTitle(
    "landdraft-test.tight-sky-0ae1.workers.dev",
    page.doc,
    page.createObserver,
  );
  assert.equal(page.doc.title, "Test-LandDraft — Friendly Maps, Real GIS Power");
  page.navigate("About LandDraft — Friendly Maps, Real GIS Power");
  assert.equal(page.doc.title, "Test-About LandDraft — Friendly Maps, Real GIS Power");
  cleanup();
  assert.equal(page.isObserving(), false);
});

test("leaves production titles untouched", () => {
  const page = fakeDocument("LandDraft");
  installTestSiteTitle("landdraft.net", page.doc, page.createObserver);
  assert.equal(page.doc.title, "LandDraft");
  assert.equal(page.isObserving(), false);
});
