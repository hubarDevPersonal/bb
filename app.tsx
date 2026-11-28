import { useEffect, useState } from "react";
import { definePluginApp, useSdk } from "@get-bb/plugin-sdk/app";
import { mountFestive } from "./festive";
import {
  getLocalStorage,
  isFestiveSeason,
  MODE_CHANGE_EVENT,
  readMode,
  SNOW_REQUEST_EVENT,
  writeMode,
  type FestiveMode,
} from "./season";
import {
  enableFestiveTheme,
  FESTIVE_THEME_ID,
  restorePreviousTheme,
} from "./theme";

const MODE_OPTIONS: ReadonlyArray<{ value: FestiveMode; label: string }> = [
  { value: "auto", label: "Авто" },
  { value: "on", label: "Всегда" },
  { value: "off", label: "Выключено" },
];

function FestiveThemeButton() {
  const sdk = useSdk();
  const [themeId, setThemeId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    sdk.theme.get().then(
      (appearance) => {
        if (!cancelled) setThemeId(appearance.themeId);
      },
      (cause: unknown) => {
        if (!cancelled) setError(String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sdk]);

  const festive = themeId === FESTIVE_THEME_ID;
  const toggle = () => {
    setPending(true);
    setError(null);
    const storage = getLocalStorage();
    (festive
      ? restorePreviousTheme(sdk.theme, storage)
      : enableFestiveTheme(sdk.theme, storage)
    ).then(
      (next) => {
        setThemeId(next);
        setPending(false);
      },
      (cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPending(false);
      },
    );
  };

  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={themeId === null || pending}
        onClick={toggle}
        className="rounded-md border border-border px-3 py-1 text-sm text-foreground hover:bg-accent disabled:opacity-60"
      >
        {festive ? "Вернуть прежнюю" : "Включить новогоднюю тему"}
      </button>
      {error === null ? null : (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

function FestiveSettings() {
  const [mode, setMode] = useState<FestiveMode>(() => readMode(getLocalStorage()));
  const choose = (next: FestiveMode) => {
    writeMode(getLocalStorage(), next);
    setMode(next);
    window.dispatchEvent(new Event(MODE_CHANGE_EVENT));
  };
  const inSeason = isFestiveSeason(new Date());

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label="Режим"
        className="inline-flex rounded-md border border-border p-0.5"
      >
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={mode === option.value}
            onClick={() => choose(option.value)}
            className={
              mode === option.value
                ? "rounded-sm bg-accent px-3 py-1 text-sm text-accent-foreground"
                : "rounded-sm px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        «Авто» включает украшения с 15 декабря по 14 января
        {inSeason ? " — сейчас как раз сезон." : "."} Настройка хранится в этом
        браузере или окне приложения.
      </p>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(SNOW_REQUEST_EVENT))}
        className="rounded-md border border-border px-3 py-1 text-sm text-foreground hover:bg-accent"
      >
        Пустить снег
      </button>
      <FestiveThemeButton />
    </div>
  );
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "festive",
    mount: ({ signal }) => mountFestive(signal),
  });
  app.slots.settingsSection({
    id: "mode",
    title: "Праздничное настроение",
    description: "Шапочки, снежинки и немного снега.",
    component: FestiveSettings,
  });
});
