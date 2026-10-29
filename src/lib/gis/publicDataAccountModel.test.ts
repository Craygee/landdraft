import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyPublicDataAccount,
  normalizePublicDataAccount,
  recordSourceHealth,
  removalEligible,
} from "./publicDataAccountModel.ts";

const at = (day: number) => new Date(`2026-10-${String(day).padStart(2, "0")}T12:00:00Z`);
test("failures count checked UTC days, not retries, and offer removal at configured threshold", () => {
  let health = recordSourceHealth(undefined, false, "HTTP 503", at(19));
  health = recordSourceHealth(health, false, "Timeout", at(19));
  assert.equal(health.failedDays, 1);
  health = recordSourceHealth(health, false, "HTTP 503", at(20));
  assert.equal(removalEligible(health, 3, at(20)), false);
  health = recordSourceHealth(health, false, "HTTP 503", at(21));
  assert.equal(health.failedDays, 3);
  assert.equal(removalEligible(health, 3, at(21)), true);
  assert.equal(removalEligible(health, 4, at(21)), false);
  assert.equal(removalEligible(health, 3, at(22)), false);
});
test("recovery and unobserved days interrupt failure streaks", () => {
  let health = recordSourceHealth(undefined, false, "Error", at(19));
  health = recordSourceHealth(health, false, "Error", at(20));
  health = recordSourceHealth(health, true, "Connected", at(20));
  assert.equal(health.failedDays, 0);
  assert.equal(removalEligible(health, 1, at(20)), false);
  health = recordSourceHealth(health, false, "Error", at(20));
  assert.equal(health.failedDays, 1);
  health = recordSourceHealth(health, false, "Error", at(22));
  assert.equal(health.failedDays, 1);
});
test("new accounts start with shipped catalog available and no account overrides", () => {
  assert.deepEqual(normalizePublicDataAccount(null), emptyPublicDataAccount());
  assert.equal(normalizePublicDataAccount({ failureDays: 100 }).failureDays, 30);
  assert.equal(normalizePublicDataAccount({ failureDays: -2 }).failureDays, 1);
  const first = emptyPublicDataAccount();
  first.removed["catalog:example"] = at(19).toISOString();
  assert.deepEqual(emptyPublicDataAccount().removed, {});
});
