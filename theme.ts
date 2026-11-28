/** Switching the app to the festive theme and back. */

/** bb namespaces plugin themes as `plugin:<plugin-id>:<theme-id>`. */
export const FESTIVE_THEME_ID = "plugin:festive:new-year";
export const PREVIOUS_THEME_KEY = "bb-festive:previous-theme";
const DEFAULT_THEME_ID = "default";

/** The slice of `useSdk().theme` this plugin needs. */
export interface ThemeControl {
  get(): Promise<{ themeId: string }>;
  set(themeId: string): Promise<{ themeId: string }>;
}

/** Applies the festive theme, remembering what was active before. */
export async function enableFestiveTheme(
  theme: ThemeControl,
  storage: Storage | null,
): Promise<string> {
  const { themeId } = await theme.get();
  if (themeId !== FESTIVE_THEME_ID) {
    try {
      storage?.setItem(PREVIOUS_THEME_KEY, themeId);
    } catch {
      // Restoring then falls back to the default theme.
    }
  }
  return (await theme.set(FESTIVE_THEME_ID)).themeId;
}

/** Restores the theme that was active before, or bb's default. */
export async function restorePreviousTheme(
  theme: ThemeControl,
  storage: Storage | null,
): Promise<string> {
  let previous: string | null = null;
  try {
    previous = storage?.getItem(PREVIOUS_THEME_KEY) ?? null;
  } catch {
    previous = null;
  }
  const target =
    previous !== null && previous !== FESTIVE_THEME_ID
      ? previous
      : DEFAULT_THEME_ID;
  const result = await theme.set(target);
  try {
    storage?.removeItem(PREVIOUS_THEME_KEY);
  } catch {
    // Nothing to clean up.
  }
  return result.themeId;
}
