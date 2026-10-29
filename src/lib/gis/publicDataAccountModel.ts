export interface AccountService {
  id: string;
  name: string;
  url: string;
  everyMap: boolean;
}
export interface SourceHealth {
  lastDay: string;
  failedDays: number;
  status: "healthy" | "error";
  message: string;
  checkedAt: string;
}
export interface PublicDataAccount {
  version: 1;
  failureDays: number;
  services: Record<string, AccountService>;
  removed: Record<string, string>;
  health: Record<string, SourceHealth>;
  overrides: Record<string, string>;
  restoredDefaults: Record<string, boolean>;
}
export const emptyPublicDataAccount = (): PublicDataAccount => ({
  version: 1,
  failureDays: 3,
  services: {},
  removed: {},
  health: {},
  overrides: {},
  restoredDefaults: {},
});
export function recordSourceHealth(
  previous: SourceHealth | undefined,
  healthy: boolean,
  message: string,
  now = new Date(),
): SourceHealth {
  const day = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const failedDays = healthy
    ? 0
    : previous?.lastDay === day
      ? Math.max(1, previous.failedDays)
      : previous?.lastDay === yesterday && previous.status === "error"
        ? previous.failedDays + 1
        : 1;
  return {
    lastDay: day,
    failedDays,
    status: healthy ? "healthy" : "error",
    message,
    checkedAt: now.toISOString(),
  };
}
export function removalEligible(health: SourceHealth | undefined, days: number, now = new Date()) {
  return (
    health?.status === "error" &&
    health.failedDays >= days &&
    health.lastDay === now.toISOString().slice(0, 10)
  );
}
export function normalizePublicDataAccount(value: unknown): PublicDataAccount {
  const base = emptyPublicDataAccount();
  if (!value || typeof value !== "object") return base;
  const candidate = value as Partial<PublicDataAccount>;
  return {
    ...base,
    ...candidate,
    version: 1,
    failureDays: Math.max(1, Math.min(30, Math.round(Number(candidate.failureDays) || 3))),
    services: candidate.services ?? {},
    removed: candidate.removed ?? {},
    health: candidate.health ?? {},
    overrides: candidate.overrides ?? {},
    restoredDefaults: candidate.restoredDefaults ?? {},
  };
}
