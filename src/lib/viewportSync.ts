/**
 * iOS Safari can keep the previous orientation's size for full-screen fixed layouts after a
 * rotation, leaving the app cut off until something forces a new layout. CSS viewport units and
 * `inset: 0` both depend on that stale size, so the measured window size is published to CSS.
 */

/** Safari reports the final size late, so a rotation is measured again as it settles. */
export const ROTATION_REMEASURE_DELAYS_MS = [100, 300, 700];

type ViewportWindow = Pick<
  Window,
  | "innerWidth"
  | "innerHeight"
  | "scrollX"
  | "scrollY"
  | "scrollTo"
  | "addEventListener"
  | "removeEventListener"
  | "setTimeout"
  | "clearTimeout"
> & {
  visualViewport?: Pick<EventTarget, "addEventListener" | "removeEventListener"> | null;
};

type StyleTarget = { setProperty(name: string, value: string): void };

export function installViewportSync(target: ViewportWindow, style: StyleTarget) {
  const timers = new Set<number>();

  const measure = () => {
    const { innerWidth: width, innerHeight: height } = target;
    if (!(width > 0 && height > 0)) return;
    style.setProperty("--app-live-width", `${width}px`);
    style.setProperty("--app-live-height", `${height}px`);
    style.setProperty("--app-viewport-height", `${height}px`);
  };

  const onRotate = () => {
    const settle = () => {
      measure();
      // A rotation can leave the locked document scrolled, hiding part of the app.
      if (target.scrollX !== 0 || target.scrollY !== 0) target.scrollTo(0, 0);
    };
    settle();
    for (const delay of ROTATION_REMEASURE_DELAYS_MS) {
      const timer = target.setTimeout(() => {
        timers.delete(timer);
        settle();
      }, delay);
      timers.add(timer);
    }
  };

  measure();
  target.addEventListener("resize", measure);
  target.addEventListener("pageshow", measure);
  target.addEventListener("orientationchange", onRotate);
  target.visualViewport?.addEventListener("resize", measure);

  return () => {
    target.removeEventListener("resize", measure);
    target.removeEventListener("pageshow", measure);
    target.removeEventListener("orientationchange", onRotate);
    target.visualViewport?.removeEventListener("resize", measure);
    for (const timer of timers) target.clearTimeout(timer);
    timers.clear();
  };
}
