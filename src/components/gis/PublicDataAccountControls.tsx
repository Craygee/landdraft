import { PublicLayerAddedBadge } from "./PublicLayerAddedBadge";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAccountPublicData } from "@/lib/gis/AccountPublicData";
import { catalog, retiredCatalog } from "@/lib/gis/catalog";
import { builtInPointIcon, pointIconTypes } from "@/lib/gis/defaultPointIcons";
import { markerIcons } from "@/lib/gis/markerIcons";
import { probeConnectionUrl } from "@/lib/gis/connectionHealth";
import {
  filterAccountServices,
  removalEligible,
  type AccountService,
} from "@/lib/gis/publicDataAccountModel";

const report = (error: unknown) =>
  toast.error("Account library was not updated", {
    description: error instanceof Error ? error.message : "Try again when connected",
  });

export function PublicDataAccountSettings() {
  const account = useAccountPublicData();
  const [days, setDays] = useState(account.config.failureDays);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDays(account.config.failureDays), [account.config.failureDays]);
  return (
    <section className="space-y-2 rounded-xl border border-border p-3 text-xs">
      <strong>Public-data connection settings</strong>
      <p className="text-muted-foreground">
        Offer account-wide removal after consecutive days with failed checks. Checks run while
        LandDraft is open; unobserved days do not count. Nothing is removed automatically.
      </p>
      <div className="flex items-center gap-2">
        <label htmlFor="public-data-failure-days">Failed days</label>
        <input
          id="public-data-failure-days"
          type="number"
          min={1}
          max={30}
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
          className="w-16 rounded border bg-background p-1 text-base"
        />
        <button
          disabled={!account.ready || saving}
          className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50"
          onClick={async () => {
            setSaving(true);
            try {
              await account.update((current) => ({ ...current, failureDays: days }));
              toast.success("Account connection settings saved");
            } catch (error) {
              report(error);
            } finally {
              setSaving(false);
            }
          }}
        >
          Save
        </button>
      </div>
      {account.error && (
        <p role="status" className="text-destructive">
          Account sync unavailable: {account.error}{" "}
          <button onClick={() => void account.reload()} className="underline">
            Retry
          </button>
        </p>
      )}
    </section>
  );
}

export function DefaultPointIconSettings() {
  const account = useAccountPublicData();
  const [busy, setBusy] = useState(false);
  const prefs = account.config.pointIcons;
  const save = async (change: (current: Record<string, string>) => Record<string, string>) => {
    setBusy(true);
    try {
      await account.update((current) => ({ ...current, pointIcons: change(current.pointIcons) }));
      toast.success("Default icons saved to your account");
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  };
  const categories = Array.from(new Set(markerIcons.map((icon) => icon.category)));
  return (
    <section className="space-y-2 rounded-xl border border-border p-3 text-xs">
      <strong>Default point icons</strong>
      <p className="text-muted-foreground">
        When a layer with points is added, LandDraft picks a fitting icon from its name. Change the
        default for a layer type here and it applies to new layers across the app. Layers already on
        a map keep their current icon.
      </p>
      <div className="max-h-64 space-y-1 overflow-y-auto">
        {pointIconTypes.map((type) => {
          const overridden = Object.prototype.hasOwnProperty.call(prefs, type.id);
          const value = overridden ? (prefs[type.id] ?? "") : (builtInPointIcon(type.id) ?? "");
          return (
            <div key={type.id} className="flex items-center gap-2">
              <label htmlFor={`default-icon-${type.id}`} className="min-w-0 flex-1 truncate">
                {type.label}
              </label>
              <select
                id={`default-icon-${type.id}`}
                disabled={!account.ready || busy}
                value={value}
                onChange={(event) =>
                  void save((current) => ({ ...current, [type.id]: event.target.value }))
                }
                className="w-40 rounded border bg-background p-1 text-base"
              >
                <option value="">Circle only</option>
                {categories.map((category) => (
                  <optgroup key={category} label={category}>
                    {markerIcons
                      .filter((icon) => icon.category === category)
                      .map((icon) => (
                        <option key={icon.id} value={icon.symbol}>
                          {icon.symbol} {icon.label}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
              <button
                disabled={!overridden || busy}
                className="underline disabled:opacity-40"
                onClick={() =>
                  void save((current) => {
                    const next = { ...current };
                    delete next[type.id];
                    return next;
                  })
                }
              >
                Reset
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function RemovePublicDataSource({ sourceId }: { sourceId: string }) {
  const account = useAccountPublicData();
  const [busy, setBusy] = useState(false);
  const health = account.config.health[sourceId];
  const eligible = removalEligible(health, account.config.failureDays);
  return (
    <div className="mt-2 text-[11px]">
      {health && (
        <p className={eligible ? "text-destructive" : "text-muted-foreground"}>
          {health.status === "error"
            ? `${health.failedDays} consecutive checked failure day(s)`
            : "Last check connected"}{" "}
          · {new Date(health.checkedAt).toLocaleString()}
          {eligible ? " · Removal suggested" : ""}
        </p>
      )}
      <button
        disabled={!account.ready || busy}
        className="mt-1 text-muted-foreground underline disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          try {
            await account.update((current) => ({
              ...current,
              removed: { ...current.removed, [sourceId]: new Date().toISOString() },
            }));
            toast.success("Removed from your account repository", {
              description:
                "Existing manually added map layers are kept. Use Reconnect at the bottom of Public data to restore this source.",
            });
          } catch (error) {
            report(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        Remove from my repository
      </button>
    </div>
  );
}

export function AccountServiceLibrary({
  onLoad,
  query = "",
  showWhenEmpty = false,
}: {
  onLoad: (service: AccountService) => void;
  query?: string;
  showWhenEmpty?: boolean;
}) {
  const account = useAccountPublicData();
  const normalizedQuery = query.trim().toLowerCase();
  const services = filterAccountServices(account.config, query);
  if (!services.length && !showWhenEmpty) return null;
  return (
    <section className="mb-3 space-y-2">
      <h3 className="text-sm font-semibold">My account services</h3>
      {!services.length && (
        <p className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
          {normalizedQuery
            ? "No connected account services match this search."
            : "No account-wide services have been connected yet."}
        </p>
      )}
      {services.map((service) => (
        <div key={service.id} className="rounded-xl border p-3 text-xs">
          <strong className="break-words">{service.name}</strong>
          <div>
            <PublicLayerAddedBadge accountServiceId={service.id} />
          </div>
          <p className="break-all text-muted-foreground">{service.url}</p>
          <button
            onClick={() => onLoad(service)}
            className="my-2 rounded bg-primary px-2 py-1 text-primary-foreground"
          >
            Add to this map
          </button>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={service.everyMap}
              onChange={async (event) => {
                const everyMap = event.target.checked;
                try {
                  await account.update((current) => ({
                    ...current,
                    services: { ...current.services, [service.id]: { ...service, everyMap } },
                  }));
                } catch (error) {
                  report(error);
                }
              }}
            />
            Automatically include on every editable map
          </label>
          <RemovePublicDataSource sourceId={`account:${service.id}`} />
        </div>
      ))}
    </section>
  );
}

export function RemovedPublicDataSources() {
  const account = useAccountPublicData();
  const [busy, setBusy] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const removed = [
    ...new Set([
      ...Object.keys(account.config.removed),
      ...retiredCatalog
        .filter((entry) => !account.config.restoredDefaults[`catalog:${entry.id}`])
        .map((entry) => `catalog:${entry.id}`),
    ]),
  ];
  if (!removed.length) return null;
  return (
    <section className="mt-4 space-y-2 rounded-xl border p-3">
      <h3 className="text-sm font-semibold">Removed sources · Reconnect</h3>
      {removed.map((id) => {
        const service = id.startsWith("account:")
          ? account.config.services[id.slice(8)]
          : [...catalog, ...retiredCatalog].find((entry) => `catalog:${entry.id}` === id);
        if (!service) return null;
        return (
          <div key={id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="break-words">{service.name}</span>
            {service.url && (
              <input
                aria-label={`Reconnect URL for ${service.name}`}
                className="w-full rounded border bg-background p-2 text-base"
                value={urls[id] ?? account.config.overrides[id] ?? service.url}
                onChange={(event) =>
                  setUrls((current) => ({ ...current, [id]: event.target.value }))
                }
              />
            )}
            <button
              disabled={busy !== null || !account.ready}
              className="rounded border px-2 py-1 disabled:opacity-50"
              onClick={async () => {
                setBusy(id);
                try {
                  const url = (urls[id] ?? account.config.overrides[id] ?? service.url)?.trim();
                  if (service.url && !url) throw new Error("Enter a service URL");
                  if (url) await probeConnectionUrl(url, 10000, true);
                  await account.update((current) => {
                    const removed = { ...current.removed };
                    delete removed[id];
                    const health = { ...current.health };
                    delete health[id];
                    const services = { ...current.services };
                    if (id.startsWith("account:") && services[id.slice(8)] && url)
                      services[id.slice(8)] = { ...services[id.slice(8)]!, url };
                    return {
                      ...current,
                      restoredDefaults: id.startsWith("catalog:")
                        ? { ...current.restoredDefaults, [id]: true }
                        : current.restoredDefaults,
                      removed,
                      health,
                      services,
                      overrides:
                        url && id.startsWith("catalog:")
                          ? { ...current.overrides, [id]: url }
                          : current.overrides,
                    };
                  });
                  toast.success("Source reconnected");
                } catch (error) {
                  toast.error("Could not reconnect", {
                    description: error instanceof Error ? error.message : "Try again later",
                  });
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === id ? "Testing…" : "Reconnect"}
            </button>
          </div>
        );
      })}
    </section>
  );
}
