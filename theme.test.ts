import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  enableFestiveTheme,
  FESTIVE_THEME_ID,
  PREVIOUS_THEME_KEY,
  restorePreviousTheme,
  type ThemeControl,
} from "./theme";

const root = import.meta.dirname;
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const themeEntry = manifest.bb.themes[0];
const css = readFileSync(join(root, themeEntry.css), "utf8");

// ---- A tiny resolver for the color syntax the theme uses -----------------

interface Oklch {
  l: number;
  c: number;
  h: number;
}

function block(mode: "light" | "dark"): Map<string, string> {
  const selector = mode === "light" ? /:root, \.light\s*\{/ : /\.dark\s*\{/;
  const start = css.search(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const vars = new Map<string, string>();
  for (const match of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    vars.set(match[1]!, match[2]!.trim());
  }
  return vars;
}

function resolve(vars: Map<string, string>, token: string): Oklch {
  const value = vars.get(token);
  if (value === undefined) throw new Error(`--${token} is not set`);
  const literal = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/);
  if (literal) return { l: +literal[1]!, c: +literal[2]!, h: +literal[3]! };
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias) return resolve(vars, alias[1]!);
  const mix = value.match(
    /^color-mix\(in oklch, var\(--([\w-]+)\) ([\d.]+)%, var\(--([\w-]+)\)\)$/,
  );
  if (mix) {
    const a = resolve(vars, mix[1]!);
    const b = resolve(vars, mix[3]!);
    const t = +mix[2]! / 100;
    let dh = b.h - a.h; // shorter hue arc, as CSS interpolates by default
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    return {
      l: a.l * t + b.l * (1 - t),
      c: a.c * t + b.c * (1 - t),
      h: (a.h + dh * (1 - t) + 360) % 360,
    };
  }
  throw new Error(`cannot resolve --${token}: ${value}`);
}

// Same math as apps/app/src/components/ui/theme.test.ts in bb.
function luminance({ l, c, h }: Oklch): number {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_;
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_;
  const bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_;
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// ---- Tests -----------------------------------------------------------------

describe("Новогодняя theme", () => {
  it("is declared in the manifest", () => {
    expect(themeEntry).toMatchObject({
      id: "new-year",
      name: "Новогодняя",
      css: "./themes/new-year.css",
    });
    expect(FESTIVE_THEME_ID).toBe(`plugin:festive:${themeEntry.id}`);
  });

  it("uses no achromatic oklch literals and no oklch-with-transparent mixes", () => {
    for (const match of css.matchAll(/oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)/g)) {
      expect(Number(match[2]), match[0]).toBeGreaterThan(0);
    }
    expect(css).not.toMatch(/color-mix\(\s*in oklch[^;]*transparent/);
  });

  for (const mode of ["light", "dark"] as const) {
    describe(mode, () => {
      const vars = block(mode);
      const canvas = resolve(vars, "canvas");

      it("derives the foreground tiers from the ink and canvas anchors", () => {
        for (const token of [
          "muted-foreground",
          "subtle-foreground",
          "readback-foreground",
        ]) {
          expect(vars.get(token)).toMatch(
            /^color-mix\(in oklch, var\(--ink\) [\d.]+%, var\(--canvas\)\)$/,
          );
        }
      });

      it.each([
        "ink",
        "muted-foreground",
        "subtle-foreground",
        "readback-foreground",
        "timeline-accent",
        "destructive-text",
        "warning-text",
        "success-foreground",
      ])("keeps --%s above the AA text floor on the canvas", (token) => {
        expect(contrast(resolve(vars, token), canvas)).toBeGreaterThanOrEqual(4.5);
      });

      it("keeps primary buttons readable", () => {
        expect(
          contrast(resolve(vars, "primary-foreground"), resolve(vars, "primary")),
        ).toBeGreaterThanOrEqual(4.5);
      });

      it("keeps muted stronger than readback stronger than subtle", () => {
        const ratio = (token: string) => contrast(resolve(vars, token), canvas);
        expect(ratio("muted-foreground")).toBeGreaterThan(ratio("readback-foreground"));
        expect(ratio("readback-foreground")).toBeGreaterThan(ratio("subtle-foreground"));
      });
    });
  }

  const bbRepo = process.env.BB_REPO ?? join(homedir(), "Dev/bb");
  const schemaPath = join(bbRepo, "packages/domain/src/plugin-manifest.ts");
  it.skipIf(!existsSync(schemaPath))(
    "passes bb's plugin manifest schema",
    async () => {
      const { pluginPackageJsonSchema } = await import(
        /* @vite-ignore */ pathToFileURL(schemaPath).href
      );
      const result = pluginPackageJsonSchema.safeParse(manifest);
      expect(result.error?.issues ?? []).toEqual([]);
    },
  );
});

describe("theme switching", () => {
  function fakeTheme(initial: string): ThemeControl & { current: string } {
    const control = {
      current: initial,
      get: vi.fn(async () => ({ themeId: control.current })),
      set: vi.fn(async (themeId: string) => {
        control.current = themeId;
        return { themeId };
      }),
    };
    return control;
  }

  function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      clear: () => map.clear(),
      getItem: (key) => map.get(key) ?? null,
      key: (index) => [...map.keys()][index] ?? null,
      removeItem: (key) => void map.delete(key),
      setItem: (key, value) => void map.set(key, value),
    };
  }

  it("remembers the previous theme and restores it", async () => {
    const theme = fakeTheme("nord");
    const storage = memoryStorage();

    await expect(enableFestiveTheme(theme, storage)).resolves.toBe(FESTIVE_THEME_ID);
    expect(storage.getItem(PREVIOUS_THEME_KEY)).toBe("nord");

    // Enabling twice must not overwrite the remembered theme with itself.
    await enableFestiveTheme(theme, storage);
    expect(storage.getItem(PREVIOUS_THEME_KEY)).toBe("nord");

    await expect(restorePreviousTheme(theme, storage)).resolves.toBe("nord");
    expect(storage.getItem(PREVIOUS_THEME_KEY)).toBeNull();
  });

  it("falls back to the default theme when nothing was remembered", async () => {
    const theme = fakeTheme(FESTIVE_THEME_ID);
    await expect(restorePreviousTheme(theme, memoryStorage())).resolves.toBe(
      "default",
    );
  });
});
