# Festive

A frontend-only bb plugin: Santa hats on agent provider logos, a snow cap on
the nav-rail Home icon, a snowflake on the "New thread" icon, a gold sparkle
on bb logos, and an evergreen running spinner. Little jokes: triple-click a bb
logo or the rail Home button for a 4-second snow burst; on Dec 31 after 23:00
it snows once by itself; on Jan 1–2 the first launch of the year shows
"С Новым годом! 🥂".

While active it also strings a twinkling garland along the top edge of the
whole window, lets sparse snow fall across it (off under reduced motion),
heaps a snow drift behind the sidebar footer buttons, and frosts the window
corners. Garland, snow and frost live in one non-interactive overlay node.
Behind the main pane (`scene.ts`, fixed-attachment backgrounds on the inset,
its headers and the thread composer footer) sit a crescent moon, Santa's
sleigh crossing every 45 s, snowy hills with pines and a lit cabin, a
snowman, and the countdown «до Нового года N дней».

The plugin ships an app theme, **Новогодняя** (`themes/new-year.css`, id
`plugin:festive:new-year`): frosty white with navy ink by day, midnight blue
with warm-white ink by night, warm gold accents. Turn it on from Settings →
Festive («Включить новогоднюю тему» / «Вернуть прежнюю») or with
`bb theme set plugin:festive:new-year`.

Active Dec 15 – Jan 14 (local date) in **Авто** mode. Settings → Festive
switches between Авто / Всегда / Выключено; the choice is stored in
`localStorage["bb-festive:mode"]` per browser profile or app window origin.
Snow is skipped under `prefers-reduced-motion`.

Everything is one content script (`festive.ts`) that injects one `<style>`
(`styles.ts`) while active and removes every node, listener, and timer on
dispose. `season.ts` holds the pure date logic.

```
npm install --include=dev
npm test && npm run typecheck && bb plugin build
```
