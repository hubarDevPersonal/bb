// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  mountPluginContentScripts,
} from "@get-bb/plugin-sdk/testing/app";
import {
  SKY_ATTR,
  NEW_YEAR_TOAST_TEXT,
  SNOW_ATTR,
  SNOW_DURATION_MS,
  SNOW_FLAKES,
  STYLE_ATTR,
  TOAST_ATTR,
  TOAST_DURATION_MS,
} from "./festive";
import { MODE_CHANGE_EVENT, MODE_STORAGE_KEY, SNOW_REQUEST_EVENT } from "./season";
import { countdownSvg, countdownText, daysWord, garlandSvg, sleighSvg, svgUrl } from "./scene";
import { FESTIVE_CSS, SKY_TILES } from "./styles";

type App = Awaited<ReturnType<typeof loadPluginApp>>;
let app: App;

beforeAll(async () => {
  app = await loadPluginApp(() => import("./app"));
});

const styles = () => document.head.querySelectorAll(`[${STYLE_ATTR}]`);
const snow = () => document.querySelector(`[${SNOW_ATTR}]`);
const toast = () => document.querySelector(`[${TOAST_ATTR}]`);
const sky = () => document.querySelectorAll(`[${SKY_ATTR}]`);
const mount = () => mountPluginContentScripts(app, { pluginId: "festive" });

function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  })) as unknown as typeof window.matchMedia;
}

function addBrandLogo(): HTMLImageElement {
  const img = document.createElement("img");
  img.src = "/assets/bb-logo-BA9hTSLL.svg";
  document.body.append(img);
  return img;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 11, 20, 12, 0, 0));
  window.localStorage.clear();
  setReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("mount and dispose", () => {
  it("adds exactly one style node in season and removes everything on dispose", async () => {
    const docAdd = vi.spyOn(document, "addEventListener");
    const docRemove = vi.spyOn(document, "removeEventListener");
    const winAdd = vi.spyOn(window, "addEventListener");
    const winRemove = vi.spyOn(window, "removeEventListener");

    const scripts = await mount();
    expect(scripts.inspection.mountedIds).toEqual(["festive"]);
    expect(styles()).toHaveLength(1);

    // Re-evaluating (a mode change event) must not add a second style node.
    window.dispatchEvent(new Event(MODE_CHANGE_EVENT));
    expect(styles()).toHaveLength(1);

    const logo = addBrandLogo();
    logo.click();
    logo.click();
    logo.click();
    expect(snow()).not.toBeNull();
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    await scripts.lifecycle.dispose();

    expect(styles()).toHaveLength(0);
    expect(snow()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    const ours = new Set(["click", "storage", MODE_CHANGE_EVENT, SNOW_REQUEST_EVENT]);
    for (const [addSpy, removeSpy] of [
      [docAdd, docRemove],
      [winAdd, winRemove],
    ] as const) {
      const added = addSpy.mock.calls
        .filter(([type]) => ours.has(type))
        .map(([type, fn]) => [type, fn]);
      const removed = removeSpy.mock.calls.map(([type, fn]) => [type, fn]);
      expect(added.length).toBeGreaterThan(0);
      for (const entry of added) expect(removed).toContainEqual(entry);
    }
  });

  it("mounts nothing visible out of season in auto mode", async () => {
    vi.setSystemTime(new Date(2026, 11, 14, 12, 0, 0));
    const scripts = await mount();
    expect(styles()).toHaveLength(0);
    await scripts.lifecycle.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("re-evaluates at local midnight with a single timer", async () => {
    vi.setSystemTime(new Date(2026, 11, 14, 23, 59, 0));
    const scripts = await mount();
    expect(styles()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(styles()).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    vi.setSystemTime(new Date(2027, 0, 14, 23, 59, 0));
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(styles()).toHaveLength(0);
    await scripts.lifecycle.dispose();
  });

  it("follows the manual override live", async () => {
    const scripts = await mount();
    expect(styles()).toHaveLength(1);

    window.localStorage.setItem(MODE_STORAGE_KEY, "off");
    window.dispatchEvent(new Event(MODE_CHANGE_EVENT));
    expect(styles()).toHaveLength(0);

    vi.setSystemTime(new Date(2026, 6, 1, 12, 0, 0));
    window.localStorage.setItem(MODE_STORAGE_KEY, "on");
    window.dispatchEvent(
      new StorageEvent("storage", { key: MODE_STORAGE_KEY, newValue: "on" }),
    );
    expect(styles()).toHaveLength(1);
    await scripts.lifecycle.dispose();
  });

  it("honors an override stored before mount", async () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, "off");
    const scripts = await mount();
    expect(styles()).toHaveLength(0);
    await scripts.lifecycle.dispose();
  });
});

describe("snow easter egg", () => {
  it("drops a snow burst on a quick triple click and removes it after 4 s", async () => {
    const scripts = await mount();
    const logo = addBrandLogo();
    logo.click();
    logo.click();
    expect(snow()).toBeNull();
    logo.click();

    const overlay = snow();
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.children).toHaveLength(SNOW_FLAKES);

    vi.advanceTimersByTime(SNOW_DURATION_MS - 1);
    expect(snow()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(snow()).toBeNull();
    await scripts.lifecycle.dispose();
  });

  it("works from the nav-rail Home button", async () => {
    const scripts = await mount();
    document.body.innerHTML =
      '<div data-testid="app-nav-rail"><button><svg data-icon="Home"></svg></button></div>';
    const home = document.querySelector("svg")!;
    for (let i = 0; i < 3; i += 1) {
      home.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
    expect(snow()).not.toBeNull();
    await scripts.lifecycle.dispose();
  });

  it("ignores slow clicks", async () => {
    const scripts = await mount();
    const logo = addBrandLogo();
    for (let i = 0; i < 3; i += 1) {
      logo.click();
      vi.advanceTimersByTime(800);
    }
    expect(snow()).toBeNull();
    await scripts.lifecycle.dispose();
  });

  it("is disabled under prefers-reduced-motion", async () => {
    setReducedMotion(true);
    const scripts = await mount();
    const logo = addBrandLogo();
    logo.click();
    logo.click();
    logo.click();
    expect(snow()).toBeNull();
    await scripts.lifecycle.dispose();
  });

  it("is disabled when the mode is off", async () => {
    window.localStorage.setItem(MODE_STORAGE_KEY, "off");
    const scripts = await mount();
    const logo = addBrandLogo();
    logo.click();
    logo.click();
    logo.click();
    expect(snow()).toBeNull();
    await scripts.lifecycle.dispose();
  });

  it("snows once by itself on Dec 31 after 23:00", async () => {
    vi.setSystemTime(new Date(2026, 11, 31, 22, 59, 0));
    let scripts = await mount();
    expect(snow()).toBeNull();
    await vi.advanceTimersByTimeAsync(61_500);
    expect(snow()).not.toBeNull();
    await scripts.lifecycle.dispose();

    // A reload the same night does not snow again.
    scripts = await mount();
    expect(snow()).toBeNull();
    await scripts.lifecycle.dispose();
  });
});

describe("new year toast", () => {
  it("shows once per year on Jan 1–2 and hides after 4 s", async () => {
    vi.setSystemTime(new Date(2027, 0, 1, 9, 0, 0));
    let scripts = await mount();
    expect(toast()?.textContent).toBe(NEW_YEAR_TOAST_TEXT);
    expect(toast()?.getAttribute("role")).toBe("status");
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(toast()).toBeNull();
    await scripts.lifecycle.dispose();

    vi.setSystemTime(new Date(2027, 0, 2, 9, 0, 0));
    scripts = await mount();
    expect(toast()).toBeNull();
    await scripts.lifecycle.dispose();

    vi.setSystemTime(new Date(2028, 0, 2, 9, 0, 0));
    scripts = await mount();
    expect(toast()).not.toBeNull();
    await scripts.lifecycle.dispose();
    expect(toast()).toBeNull();
  });

  it("does not show on Jan 3 or when the mode is off", async () => {
    vi.setSystemTime(new Date(2027, 0, 3, 9, 0, 0));
    let scripts = await mount();
    expect(toast()).toBeNull();
    await scripts.lifecycle.dispose();

    vi.setSystemTime(new Date(2027, 0, 1, 9, 0, 0));
    window.localStorage.setItem(MODE_STORAGE_KEY, "off");
    scripts = await mount();
    expect(toast()).toBeNull();
    await scripts.lifecycle.dispose();
  });
});

describe("app-shell decorations", () => {
  function renderShell() {
    document.body.innerHTML = `
      <div data-sidebar="panel" style="position: fixed">
        <div data-sidebar="sidebar">
          <div data-sidebar="content"></div>
          <div data-sidebar="footer"><button>Settings</button></div>
        </div>
      </div>
      <main data-sidebar="inset"></main>`;
  }

  it("adds one sky overlay with the style and removes both on dispose", async () => {
    renderShell();
    const before = document.body.innerHTML;
    const scripts = await mount();
    expect(sky()).toHaveLength(1);
    expect(sky()[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(sky()[0]!).pointerEvents).toBe("none");

    // Toggling off and on again does not stack overlays.
    window.localStorage.setItem(MODE_STORAGE_KEY, "off");
    window.dispatchEvent(new Event(MODE_CHANGE_EVENT));
    expect(sky()).toHaveLength(0);
    window.localStorage.setItem(MODE_STORAGE_KEY, "on");
    window.dispatchEvent(new Event(MODE_CHANGE_EVENT));
    expect(sky()).toHaveLength(1);

    await scripts.lifecycle.dispose();
    expect(sky()).toHaveLength(0);
    expect(styles()).toHaveLength(0);
    // The app's own sidebar markup is left exactly as it was.
    expect(document.body.innerHTML).toBe(before);
  });

  it("draws the garland and drift with non-interactive pseudo-elements only", async () => {
    renderShell();
    const before = document.querySelector('[data-sidebar="sidebar"]')!.innerHTML;
    const scripts = await mount();
    // The app's own sidebar subtree is never touched.
    expect(document.querySelector('[data-sidebar="sidebar"]')!.innerHTML).toBe(before);

    for (const selector of [
      "[data-bb-festive-sky]::after",
      '[data-sidebar="footer"]:not(.absolute, .fixed, .sticky)::before',
    ]) {
      // The first rule naming each pseudo-element is its shared base rule.
      const start = FESTIVE_CSS.indexOf(selector);
      expect(start, selector).toBeGreaterThan(-1);
      const rule = FESTIVE_CSS.slice(start, FESTIVE_CSS.indexOf("}", start));
      expect(rule, selector).toContain("pointer-events: none");
      expect(rule, selector).toContain("position: absolute");
    }
    await scripts.lifecycle.dispose();
  });

  it("keeps every motion inside a no-preference media query", () => {
    const insideNoPreference = (index: number) => {
      const before = FESTIVE_CSS.slice(0, index);
      const media = before.lastIndexOf("@media (prefers-reduced-motion: no-preference)");
      if (media === -1) return false;
      const opened = before.slice(media);
      return (opened.match(/\{/g) ?? []).length - (opened.match(/\}/g) ?? []).length > 0;
    };
    const animated = [...FESTIVE_CSS.matchAll(/animation:\s*bb-festive-(\S+)/g)];
    expect(animated.map((match) => match[1])).toEqual(
      expect.arrayContaining(["sky-snow", "toast"]),
    );
    for (const match of animated) {
      if (match[1] === "fall") continue; // the burst overlay is never created under reduced motion
      expect(insideNoPreference(match.index!), match[0]).toBe(true);
    }
    // SVGs that animate internally (twinkling garland, the sleigh) too.
    for (const svg of [svgUrl(garlandSvg(true)), svgUrl(sleighSvg())]) {
      const index = FESTIVE_CSS.indexOf(svg);
      expect(index).toBeGreaterThan(-1);
      expect(insideNoPreference(index)).toBe(true);
    }
    expect(FESTIVE_CSS).toContain(svgUrl(garlandSvg(false)));
  });

  it("keeps window snowfall as sparse as the sidebar snow was", () => {
    // Flakes on a 1400x850 window; the sidebar-only version had ~10 in 264x850.
    const perPx = SKY_TILES.reduce((sum, t) => sum + t.flakes / (t.width * t.height), 0);
    const onScreen = perPx * 1400 * 850;
    expect(onScreen).toBeGreaterThan(30);
    expect(onScreen).toBeLessThanOrEqual(60);
  });

  it("shows snowfall only when motion is allowed", async () => {
    const base = FESTIVE_CSS.indexOf("[data-bb-festive-sky] > [data-bb-festive-sky-snow] {");
    expect(FESTIVE_CSS.slice(base, FESTIVE_CSS.indexOf("}", base))).toContain("display: none");
    const scripts = await mount();
    expect(document.querySelectorAll("[data-bb-festive-sky-snow]")).toHaveLength(1);
    await scripts.lifecycle.dispose();
    expect(document.querySelectorAll("[data-bb-festive-sky-snow]")).toHaveLength(0);
  });
});

describe("winter scene", () => {
  it("counts down in Russian with correct plurals", () => {
    expect([1, 2, 5, 11, 21, 22, 25, 34, 111].map(daysWord)).toEqual([
      "день", "дня", "дней", "дней", "день", "дня", "дней", "дня", "дней",
    ]);
    expect(countdownText(new Date(2026, 10, 28))).toBe("до Нового года 34 дня");
    expect(countdownText(new Date(2026, 11, 31, 10))).toBe("Новый год сегодня 🥂");
    expect(countdownText(new Date(2027, 0, 5))).toBe("С Новым 2027! ✨");
  });

  it("paints the scene behind the main pane and its composer footer", async () => {
    const scripts = await mount();
    const css = styles()[0]!.textContent!;
    expect(css).toContain('main[data-sidebar="inset"], :where(main[data-sidebar="inset"]) header {');
    expect(css).toContain('[data-scroll-footer] > div {');
    expect(css).toContain("background-attachment: fixed");
    await scripts.lifecycle.dispose();
    expect(styles()).toHaveLength(0);
  });

  it("updates the countdown at midnight without adding style nodes", async () => {
    vi.setSystemTime(new Date(2026, 11, 30, 23, 59, 0));
    const scripts = await mount();
    const today = svgUrl(countdownSvg(countdownText(new Date(2026, 11, 30))));
    expect(styles()[0]!.textContent).toContain(today);

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(styles()).toHaveLength(1);
    const tomorrow = svgUrl(countdownSvg("Новый год сегодня 🥂"));
    expect(styles()[0]!.textContent).toContain(tomorrow);
    expect(styles()[0]!.textContent).not.toContain(today);
    await scripts.lifecycle.dispose();
  });
});
