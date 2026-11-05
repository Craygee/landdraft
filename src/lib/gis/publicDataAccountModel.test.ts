import assert from "node:assert/strict";
import test from "node:test";
import {
  disableEveryMapServices,
  emptyPublicDataAccount,
  filterAccountServices,
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

test("account service filtering keeps removed entries private and sorts visible matches", () => {
  const account = emptyPublicDataAccount();
  account.services = {
    removed: {
      id: "removed",
      name: "Removed power service",
      url: "https://example.com/removed",
      everyMap: false,
    },
    zulu: {
      id: "zulu",
      name: "Zulu pipelines",
      url: "https://example.com/pipeline",
      everyMap: false,
    },
    alpha: {
      id: "alpha",
      name: "Alpha plants",
      url: "https://example.com/power",
      everyMap: true,
    },
  };
  account.removed["account:removed"] = "2026-11-05T00:00:00Z";

  assert.deepEqual(
    filterAccountServices(account).map((service) => service.id),
    ["alpha", "zulu"],
  );
  assert.deepEqual(
    filterAccountServices(account, "POWER").map((service) => service.id),
    ["alpha"],
  );
});

test("deleting managed map layers can stop only their every-map services", () => {
  const account = emptyPublicDataAccount();
  account.services = {
    gas: {
      id: "gas",
      name: "Texas Gas Plants",
      url: "https://example.com/gas",
      everyMap: true,
    },
    iou: {
      id: "iou",
      name: "IOU - Overview",
      url: "https://example.com/iou",
      everyMap: true,
    },
    manual: {
      id: "manual",
      name: "Manual connection",
      url: "https://example.com/manual",
      everyMap: false,
    },
  };

  const next = disableEveryMapServices(account, ["gas", "iou", "missing"]);

  assert.equal(next.services["gas"]?.everyMap, false);
  assert.equal(next.services["iou"]?.everyMap, false);
  assert.equal(next.services["manual"]?.everyMap, false);
  assert.equal(account.services["gas"]?.everyMap, true);
  assert.equal(disableEveryMapServices(next, ["manual"]), next);
});
