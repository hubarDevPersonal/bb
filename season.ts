/**
 * Pure date and preference logic. Everything uses the local calendar, so a
 * user in Moscow and one in Lisbon each get their own Dec 15 and midnight.
 */

export type FestiveMode = "auto" | "on" | "off";

export const MODE_STORAGE_KEY = "bb-festive:mode";
/** Fired on `window` by the settings section after it writes the mode. */
export const MODE_CHANGE_EVENT = "bb-festive:mode-change";
/** Fired on `window` by the settings section's "let it snow" button. */
export const SNOW_REQUEST_EVENT = "bb-festive:snow";

const TOAST_KEY_PREFIX = "bb-festive:new-year-toast:";
const NYE_SNOW_KEY_PREFIX = "bb-festive:nye-snow:";

export function parseMode(value: string | null | undefined): FestiveMode {
  return value === "on" || value === "off" ? value : "auto";
}

export function readMode(storage: Storage | null): FestiveMode {
  return parseMode(safeGet(storage, MODE_STORAGE_KEY));
}

export function writeMode(storage: Storage | null, mode: FestiveMode): void {
  safeSet(storage, MODE_STORAGE_KEY, mode);
}

/** Dec 15 – Jan 14 inclusive, local date. */
export function isFestiveSeason(date: Date): boolean {
  const month = date.getMonth();
  const day = date.getDate();
  return (month === 11 && day >= 15) || (month === 0 && day <= 14);
}

/** The custom property the «Новогодняя» theme sets on :root. */
export const THEME_MARKER_PROPERTY = "--bb-festive-theme";

export function isFestiveActive(
  mode: FestiveMode,
  date: Date,
  themeActive = false,
): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return themeActive || isFestiveSeason(date);
}

export function isFestiveThemeActive(): boolean {
  if (typeof document === "undefined") return false;
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue(THEME_MARKER_PROPERTY)
      .trim() === "1"
  );
}

export function isNewYearToastDay(date: Date): boolean {
  return date.getMonth() === 0 && date.getDate() <= 2;
}

export function isNewYearsEveSnowTime(date: Date): boolean {
  return (
    date.getMonth() === 11 && date.getDate() === 31 && date.getHours() >= 23
  );
}

/**
 * The next moment the plugin must re-evaluate: the coming local midnight,
 * or Dec 31 23:00 when that is still ahead today.
 */
export function nextBoundary(now: Date): Date {
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0,
  );
  if (now.getMonth() === 11 && now.getDate() === 31 && now.getHours() < 23) {
    return new Date(now.getFullYear(), 11, 31, 23, 0, 0, 0);
  }
  return midnight;
}

/** True once per calendar year; marks the year as used. */
export function claimNewYearToast(storage: Storage | null, date: Date): boolean {
  return claimOnce(storage, `${TOAST_KEY_PREFIX}${date.getFullYear()}`);
}

/** True once per Dec 31; marks the year as used. */
export function claimNewYearsEveSnow(
  storage: Storage | null,
  date: Date,
): boolean {
  return claimOnce(storage, `${NYE_SNOW_KEY_PREFIX}${date.getFullYear()}`);
}

function claimOnce(storage: Storage | null, key: string): boolean {
  if (storage === null) return false;
  if (safeGet(storage, key) !== null) return false;
  // Refuse when the flag cannot be persisted, so a broken storage never
  // turns a once-a-year joke into an every-reload one.
  return safeSet(storage, key, "1");
}

function safeGet(storage: Storage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | null, key: string, value: string): boolean {
  if (storage === null) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function getLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
}
