import {
  claimNewYearToast,
  claimNewYearsEveSnow,
  getLocalStorage,
  isFestiveActive,
  isFestiveThemeActive,
  isNewYearToastDay,
  isNewYearsEveSnowTime,
  MODE_CHANGE_EVENT,
  MODE_STORAGE_KEY,
  nextBoundary,
  readMode,
  SNOW_REQUEST_EVENT,
} from "./season";
import { festiveCss } from "./styles";

export const STYLE_ATTR = "data-bb-festive-style";
export const SNOW_ATTR = "data-bb-festive-snow";
export const TOAST_ATTR = "data-bb-festive-toast";
export const SKY_ATTR = "data-bb-festive-sky";

export const SNOW_DURATION_MS = 4000;
export const TOAST_DURATION_MS = 4000;
export const SNOW_FLAKES = 40;
export const NEW_YEAR_TOAST_TEXT = "С Новым годом! 🥂";

/** Max gap between brand clicks that still counts as "quickly". */
const TRIPLE_CLICK_GAP_MS = 500;

export function prefersReducedMotion(): boolean {
  try {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

/** The bb logo image, or the nav-rail Home button (the sidebar's brand spot). */
export function findBrandTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  const logo = target.closest('img[src*="/bb-logo"]');
  if (logo !== null) return logo;
  const button = target.closest("button");
  if (button === null || button.closest('[data-testid="app-nav-rail"]') === null) {
    return null;
  }
  for (const child of Array.from(button.children)) {
    if (child.getAttribute("data-icon") === "Home") return button;
  }
  return null;
}

/**
 * Installs Festive into `document` and returns an idempotent disposer that
 * removes every node, listener, and timer it created. Aborting `signal`
 * disposes too.
 */
export function mountFestive(signal: AbortSignal): () => void {
  const storage = getLocalStorage();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let style: HTMLStyleElement | null = null;
  let sky: HTMLElement | null = null;
  let snow: HTMLElement | null = null;
  let toast: HTMLElement | null = null;
  let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
  let clickCount = 0;
  let lastClickAt = 0;
  let disposed = false;

  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  const removeSnow = () => {
    snow?.remove();
    snow = null;
  };
  const removeToast = () => {
    toast?.remove();
    toast = null;
  };

  const letItSnow = (): boolean => {
    if (disposed || style === null || snow !== null) return false;
    if (prefersReducedMotion()) return false;
    const overlay = document.createElement("div");
    overlay.setAttribute(SNOW_ATTR, "");
    overlay.setAttribute("aria-hidden", "true");
    for (let index = 0; index < SNOW_FLAKES; index += 1) {
      const flake = document.createElement("span");
      const size = 3 + Math.random() * 4;
      flake.style.setProperty("--x", `${(Math.random() * 100).toFixed(2)}%`);
      flake.style.setProperty("--s", `${size.toFixed(1)}px`);
      flake.style.setProperty("--o", (0.55 + Math.random() * 0.45).toFixed(2));
      flake.style.setProperty("--d", `${Math.round(Math.random() * 700)}ms`);
      flake.style.setProperty("--t", `${Math.round(2300 + Math.random() * 1000)}ms`);
      flake.style.setProperty("--drift", `${Math.round(Math.random() * 80 - 40)}px`);
      overlay.append(flake);
    }
    document.body.append(overlay);
    snow = overlay;
    later(removeSnow, SNOW_DURATION_MS);
    return true;
  };

  const showToast = () => {
    if (disposed || toast !== null) return;
    const pill = document.createElement("div");
    pill.setAttribute(TOAST_ATTR, "");
    pill.setAttribute("role", "status");
    pill.setAttribute("aria-live", "polite");
    pill.textContent = NEW_YEAR_TOAST_TEXT;
    document.body.append(pill);
    toast = pill;
    later(removeToast, TOAST_DURATION_MS);
  };

  const onClick = (event: MouseEvent) => {
    if (findBrandTarget(event.target) === null) {
      clickCount = 0;
      return;
    }
    const now = Date.now();
    clickCount = now - lastClickAt <= TRIPLE_CLICK_GAP_MS ? clickCount + 1 : 1;
    lastClickAt = now;
    if (clickCount >= 3) {
      clickCount = 0;
      letItSnow();
    }
  };

  const activate = (now: Date) => {
    if (style !== null) {
      // The countdown in the stylesheet changes once a day.
      const css = festiveCss(now);
      if (style.textContent !== css) style.textContent = css;
      return;
    }
    style = document.createElement("style");
    style.setAttribute(STYLE_ATTR, "");
    style.textContent = festiveCss(now);
    document.head.append(style);
    sky = document.createElement("div");
    sky.setAttribute(SKY_ATTR, "");
    sky.setAttribute("aria-hidden", "true");
    const snowfall = document.createElement("div");
    snowfall.setAttribute("data-bb-festive-sky-snow", "");
    sky.append(snowfall);
    document.body.append(sky);
    // Capture phase so a row handler's stopPropagation cannot hide clicks.
    document.addEventListener("click", onClick, true);
  };

  const deactivate = () => {
    document.removeEventListener("click", onClick, true);
    clickCount = 0;
    removeSnow();
    removeToast();
    sky?.remove();
    sky = null;
    style?.remove();
    style = null;
  };

  const evaluate = () => {
    if (disposed) return;
    const now = new Date();
    if (!isFestiveActive(readMode(storage), now, isFestiveThemeActive())) {
      deactivate();
      return;
    }
    activate(now);
    if (isNewYearToastDay(now) && claimNewYearToast(storage, now)) {
      showToast();
    }
    if (
      isNewYearsEveSnowTime(now) &&
      !prefersReducedMotion() &&
      claimNewYearsEveSnow(storage, now)
    ) {
      letItSnow();
    }
  };

  const scheduleBoundary = () => {
    if (disposed) return;
    if (boundaryTimer !== null) clearTimeout(boundaryTimer);
    const now = new Date();
    // A second of slack so the callback lands inside the new day.
    const delay = Math.max(1000, nextBoundary(now).getTime() - now.getTime() + 1000);
    boundaryTimer = setTimeout(() => {
      boundaryTimer = null;
      evaluate();
      scheduleBoundary();
    }, delay);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === MODE_STORAGE_KEY) evaluate();
  };
  const onSnowRequest = () => {
    letItSnow();
  };

  let themeFrame: number | null = null;
  const themeObserver =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(() => {
          if (themeFrame !== null) return;
          themeFrame = requestAnimationFrame(() => {
            themeFrame = null;
            evaluate();
          });
        });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    themeObserver?.disconnect();
    if (themeFrame !== null) cancelAnimationFrame(themeFrame);
    themeFrame = null;
    signal.removeEventListener("abort", dispose);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(MODE_CHANGE_EVENT, evaluate);
    window.removeEventListener(SNOW_REQUEST_EVENT, onSnowRequest);
    if (boundaryTimer !== null) clearTimeout(boundaryTimer);
    boundaryTimer = null;
    for (const id of timers) clearTimeout(id);
    timers.clear();
    deactivate();
  };

  if (signal.aborted) return dispose;
  window.addEventListener("storage", onStorage);
  window.addEventListener(MODE_CHANGE_EVENT, evaluate);
  window.addEventListener(SNOW_REQUEST_EVENT, onSnowRequest);
  signal.addEventListener("abort", dispose, { once: true });
  themeObserver?.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  themeObserver?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  evaluate();
  scheduleBoundary();
  return dispose;
}
