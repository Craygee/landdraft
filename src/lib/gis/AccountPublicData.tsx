import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth";
import {
  downloadPrivateProjectFile,
  uploadPrivateProjectFile,
  CloudRequestError,
} from "@/lib/cloud";
import {
  emptyPublicDataAccount,
  normalizePublicDataAccount,
  recordSourceHealth,
  type PublicDataAccount,
} from "./publicDataAccountModel";
import type { ConnectionResult } from "./connectionHealth";

// An account-owned file uses the existing private bucket and owner-only policies.
// The reserved UUID keeps this distinct from real project snapshots and shares.
const accountPath = (id: string) =>
  `${id}/00000000-0000-4000-8000-000000000000/account/public-data.json`;
async function readCloudAccount(id: string) {
  try {
    const bytes = await downloadPrivateProjectFile(accountPath(id));
    return normalizePublicDataAccount(JSON.parse(new TextDecoder().decode(bytes)));
  } catch (error) {
    if (
      error instanceof CloudRequestError &&
      (error.status === 404 || (error.status === 400 && /^object not found$/i.test(error.message)))
    )
      return emptyPublicDataAccount();
    throw error;
  }
}
interface AccountDataApi {
  config: PublicDataAccount;
  ready: boolean;
  error: string;
  update: (change: (current: PublicDataAccount) => PublicDataAccount) => Promise<void>;
  recordHealth: (results: ConnectionResult[]) => Promise<void>;
  reload: () => Promise<void>;
}
const Context = createContext<AccountDataApi | null>(null);
export function AccountPublicDataProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const userId = auth.user?.id;
  const [config, setConfig] = useState(emptyPublicDataAccount);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const currentUser = useRef(userId);
  const revision = useRef(0);
  currentUser.current = userId;
  const localKey = `landdraft.public-data.account.v1:${userId}`;
  const reload = useCallback(async () => {
    if (!userId) return;
    const started = revision.current;
    try {
      let next: PublicDataAccount;
      if (auth.cloudEnabled) {
        next = await readCloudAccount(userId);
      } else
        next = normalizePublicDataAccount(JSON.parse(localStorage.getItem(localKey) ?? "null"));
      if (currentUser.current !== userId || started !== revision.current) return;
      setConfig(next);
      localStorage.setItem(localKey, JSON.stringify(next));
      setError("");
      setReady(true);
    } catch (err) {
      if (currentUser.current !== userId) return;
      setError(err instanceof Error ? err.message : "Account library could not sync");
      // Do not apply stale account removals or global layers until cloud state is read.
      setReady(false);
    }
  }, [auth.cloudEnabled, localKey, userId]);
  useEffect(() => {
    setReady(false);
    setConfig(emptyPublicDataAccount());
    void reload();
    const refresh = () => {
      void reload();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [reload]);
  const update = useCallback(
    (change: (current: PublicDataAccount) => PublicDataAccount) => {
      const task = queue.current
        .catch(() => {})
        .then(async () => {
          if (!userId || currentUser.current !== userId)
            throw new Error("Sign in to update your account library");
          let latest: PublicDataAccount;
          if (auth.cloudEnabled) {
            latest = await readCloudAccount(userId);
          } else
            latest = normalizePublicDataAccount(
              JSON.parse(localStorage.getItem(localKey) ?? "null"),
            );
          const next = normalizePublicDataAccount(change(latest));
          if (currentUser.current !== userId)
            throw new Error("Account changed before this update could be saved");
          if (auth.cloudEnabled)
            await uploadPrivateProjectFile(
              accountPath(userId),
              new Blob([JSON.stringify(next)], { type: "application/json" }),
            );
          if (currentUser.current !== userId) return;
          revision.current += 1;
          localStorage.setItem(localKey, JSON.stringify(next));
          setConfig(next);
          setReady(true);
          setError("");
        });
      queue.current = task;
      return task;
    },
    [auth.cloudEnabled, localKey, userId],
  );
  const recordHealth = useCallback(
    async (results: ConnectionResult[]) => {
      if (
        !navigator.onLine ||
        !results.length ||
        (results.length > 1 && results.every((result) => result.status === "error"))
      )
        return;
      await update((current) => {
        const health = { ...current.health };
        for (const result of results) {
          const custom = Object.values(current.services).find(
            (service) => service.url === result.configuredUrl || service.url === result.url,
          );
          const key = custom
            ? `account:${custom.id}`
            : result.id.startsWith("catalog:")
              ? result.id
              : null;
          if (key && !current.removed[key])
            health[key] = recordSourceHealth(
              health[key],
              result.status !== "error",
              result.message,
            );
        }
        return { ...current, health };
      });
    },
    [update],
  );
  return (
    <Context.Provider value={{ config, ready, error, update, recordHealth, reload }}>
      {children}
    </Context.Provider>
  );
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAccountPublicData() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing account public data provider");
  return value;
}
