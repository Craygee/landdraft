import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "landdraft.button-help.v1";
const CONTROL_SELECTOR =
  "button, [role='button'], a[href], input[type='button'], input[type='submit']";

export interface ButtonHelpPreferences {
  enabled: boolean;
  delayMs: number;
}

interface ButtonHelpContextValue extends ButtonHelpPreferences {
  setEnabled: (enabled: boolean) => void;
  setDelayMs: (delayMs: number) => void;
}

interface TooltipState {
  description: string;
  x: number;
  y: number;
  above: boolean;
}

const DEFAULT_PREFERENCES: ButtonHelpPreferences = {
  enabled: true,
  delayMs: 1000,
};

const ButtonHelpContext = createContext<ButtonHelpContextValue | null>(null);

function loadPreferences(): ButtonHelpPreferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    ) as Partial<ButtonHelpPreferences> | null;
    return {
      enabled: stored?.enabled ?? DEFAULT_PREFERENCES.enabled,
      delayMs: [600, 1000, 1500].includes(Number(stored?.delayMs))
        ? Number(stored?.delayMs)
        : DEFAULT_PREFERENCES.delayMs,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function controlDescription(control: HTMLElement): string {
  const explicit =
    control.dataset["help"]?.trim() ||
    control.getAttribute("title")?.trim() ||
    control.getAttribute("aria-description")?.trim() ||
    control.getAttribute("aria-label")?.trim();
  if (explicit) return explicit;

  const text = control.textContent?.replace(/\s+/g, " ").trim();
  if (!text) return "Activate this control";
  return text.length > 120 ? `${text.slice(0, 117)}…` : `Use ${text}`;
}

function closestControl(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? (target.closest(CONTROL_SELECTOR) as HTMLElement | null)
    : null;
}

export function ButtonHelpProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(loadPreferences);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const timerRef = useRef<number | null>(null);
  const activeControlRef = useRef<HTMLElement | null>(null);
  const hiddenTitleRef = useRef<{ control: HTMLElement; title: string } | null>(null);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const restoreTitle = () => {
      const hidden = hiddenTitleRef.current;
      if (hidden && hidden.control.isConnected && !hidden.control.hasAttribute("title")) {
        hidden.control.setAttribute("title", hidden.title);
      }
      hiddenTitleRef.current = null;
    };

    const hide = () => {
      clearTimer();
      setTooltip(null);
      activeControlRef.current = null;
      restoreTitle();
    };

    if (!preferences.enabled) {
      hide();
      return;
    }

    const schedule = (control: HTMLElement) => {
      if (activeControlRef.current === control) return;
      hide();
      activeControlRef.current = control;

      const description = controlDescription(control);
      const nativeTitle = control.getAttribute("title");
      if (nativeTitle) {
        hiddenTitleRef.current = { control, title: nativeTitle };
        control.removeAttribute("title");
      }

      timerRef.current = window.setTimeout(() => {
        if (activeControlRef.current !== control || !control.isConnected) return;
        const rect = control.getBoundingClientRect();
        const tooltipHalfWidth = Math.min(170, Math.max(100, window.innerWidth / 2 - 12));
        const x = Math.min(
          window.innerWidth - tooltipHalfWidth,
          Math.max(tooltipHalfWidth, rect.left + rect.width / 2),
        );
        const above = rect.bottom + 90 > window.innerHeight;
        setTooltip({
          description,
          x,
          y: above ? rect.top - 10 : rect.bottom + 10,
          above,
        });
        timerRef.current = null;
      }, preferences.delayMs);
    };

    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") return;
      const control = closestControl(event.target);
      if (control) schedule(control);
    };
    const onPointerOut = (event: PointerEvent) => {
      const active = activeControlRef.current;
      if (!active) return;
      const next = event.relatedTarget;
      if (next instanceof Node && active.contains(next)) return;
      hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const control = closestControl(event.target);
      if (control) schedule(control);
    };
    const onFocusOut = (event: FocusEvent) => {
      const active = activeControlRef.current;
      if (active && event.target instanceof Node && active.contains(event.target)) hide();
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      hide();
    };
  }, [preferences.delayMs, preferences.enabled]);

  const value = useMemo<ButtonHelpContextValue>(
    () => ({
      ...preferences,
      setEnabled: (enabled) => setPreferences((current) => ({ ...current, enabled })),
      setDelayMs: (delayMs) => setPreferences((current) => ({ ...current, delayMs })),
    }),
    [preferences],
  );

  return (
    <ButtonHelpContext.Provider value={value}>
      {children}
      {tooltip && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-[120] max-w-[min(21rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-xl border border-border bg-popover px-3 py-2 text-center text-xs font-medium leading-snug text-popover-foreground shadow-float"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: `translate(-50%, ${tooltip.above ? "-100%" : "0"})`,
          }}
        >
          {tooltip.description}
        </div>
      )}
    </ButtonHelpContext.Provider>
  );
}

// The provider and its hook intentionally live together so every route uses one preference source.
// eslint-disable-next-line react-refresh/only-export-components
export function useButtonHelp() {
  const value = useContext(ButtonHelpContext);
  if (!value) throw new Error("useButtonHelp must be used inside ButtonHelpProvider");
  return value;
}
