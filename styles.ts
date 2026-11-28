/**
 * The one stylesheet Festive injects while it is active.
 *
 * Every selector targets a hook the bb app renders today (see README):
 * provider logos, the nav-rail Home button, the "new thread" glyph, bb logo
 * images, and the sidebar running spinner. Shapes are monochrome SVG masks
 * or gradients painted with theme tokens, so custom palettes and light/dark
 * both follow along. Decorations never change layout: pseudo-elements are
 * absolutely positioned, and the padding added to replaced icons is cancelled
 * by an equal negative margin.
 */

import {
  COUNTDOWN_BOX,
  countdownSvg,
  countdownText,
  GARLAND_TILE,
  SLEIGH_BAND,
  garlandSvg,
  hillsSvg,
  moonSvg,
  sleighSvg,
  snowmanSvg,
  svgUrl,
} from "./scene";

function svgMask(viewBox: string, body: string, attrs = ""): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${attrs}>${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const HAT_CONE =
  "M3.5 18.5C4.6 11.4 8.4 6 14.6 4.1c3.1-.9 5.6.4 6.4 3.3l-2.6.9c-.5-1.3-1.5-1.8-2.9-1.4-1.6 3.4-.9 7.3 2.6 11.6z";
const HAT_BRIM =
  "M4.3 16.4h14.4a2.3 2.3 0 0 1 0 4.6H4.3a2.3 2.3 0 0 1 0-4.6z";
const HAT_POMPOM = "M22.5 8.3a2.7 2.7 0 1 1-5.4 0a2.7 2.7 0 1 1 5.4 0z";

/** Red silhouette, including an outline around the fur so it reads on white. */
const HAT_RED_MASK = svgMask(
  "0 0 24 24",
  `<path d="${HAT_CONE}"/><path d="${HAT_BRIM}${HAT_POMPOM}" stroke="#000" stroke-width="1.8" stroke-linejoin="round"/>`,
);
const HAT_FUR_MASK = svgMask("0 0 24 24", `<path d="${HAT_BRIM}${HAT_POMPOM}"/>`);

/** Snow along the roof of Hugeicons Home07 (the rail Home glyph), in icon units. */
const SNOW_CAP_MASK = svgMask(
  "0 -1.5 24 12",
  '<path d="M2.6 8.4 12 1.2l9.4 7.2" fill="none" stroke="#000" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="6.9" r="1"/><circle cx="17.4" cy="7.2" r="0.8"/>',
);

/** Agent provider logos (`ProviderIcon`); environment/machine logos carry `%3A`. */
const PROVIDER_ICON_HOST =
  'span:has(> [data-provider-logo*="/api/v1/system/providers/"]:not([data-provider-logo*="%3A"])):not(.absolute, .fixed, .sticky)';
const HOME_RAIL_BUTTON =
  ':where([data-testid="app-nav-rail"]) button:has(> [data-icon="Home"])';
const NEW_THREAD_GLYPH =
  ':where([data-sidebar-navigation-item="__bb__/new-thread"], [data-sidebar-header-slot]) [data-icon="MessageSquarePlus"]';
const BB_LOGO_IMAGE = 'img[src*="/bb-logo"]';
const RUNNING_SPINNER =
  ':where([data-sidebar-thread-trailing-indicator]) [data-icon="Loading"]';

/** Paints a tiny 8-armed sparkle in the top-right corner of a box. */
function cornerSparkle(color: string, size: number): string {
  const bar = `linear-gradient(${color}, ${color})`;
  const offset = (size - 1.5) / 2;
  const layers = [
    `${bar} right ${offset}px top 0 / 1.5px ${size}px no-repeat`,
    `${bar} right 0 top ${offset}px / ${size}px 1.5px no-repeat`,
  ];
  for (const angle of ["45deg", "-45deg"]) {
    layers.push(
      `linear-gradient(${angle}, transparent calc(50% - 0.6px), ${color} 0 calc(50% + 0.6px), transparent 0) right 0.75px top 0.75px / ${size - 1.5}px ${size - 1.5}px no-repeat`,
    );
  }
  return layers.join(", ");
}


/* ---------- App-shell decorations ---------- */

const SIDEBAR_FOOTER =
  ':where([data-sidebar="panel"]) [data-sidebar="footer"]:not(.absolute, .fixed, .sticky)';

const DRIFT_MASK = svgMask(
  "0 0 200 16",
  '<path d="M0 16V11C18 9 30 6 52 8C70 10 82 4 106 5C128 6 142 11 162 9C180 7 190 4 200 5V16Z"/>',
  ' preserveAspectRatio="none"',
);

/** Deterministic PRNG so the snow tiles are identical on every load. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/**
 * Window-wide snowfall: two tiles of scattered flakes (as masks, so the
 * flake color stays a theme token) that scroll down by exactly their own
 * height, so the loop is seamless. Different tile sizes keep the repeats
 * from lining up. Density matches the sidebar-only snow the user liked:
 * about 10 flakes per sidebar-sized column.
 */
export const SKY_TILES: ReadonlyArray<{ width: number; height: number; flakes: number }> = [
  { width: 560, height: 700, flakes: 10 },
  { width: 760, height: 900, flakes: 12 },
];
const SKY_SNOW_MASKS = SKY_TILES.map(({ width, height, flakes }, index) => {
  const random = seeded(2026 + index);
  const circles = Array.from({ length: flakes }, () => {
    const x = (random() * width).toFixed(1);
    const y = (random() * height).toFixed(1);
    const r = (1.2 + random() * 0.8).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="${r}"/>`;
  }).join("");
  return svgMask(`0 0 ${width} ${height}`, circles);
});
const SKY_SNOW_MASK_IMAGE = SKY_SNOW_MASKS.join(", ");
const SKY_SNOW_MASK_SIZE = SKY_TILES.map(({ width, height }) => `${width}px ${height}px`).join(", ");
const SKY_SNOW_FROM = SKY_TILES.map(() => "0 0").join(", ");
const SKY_SNOW_TO = SKY_TILES.map(({ height }) => `0 ${height}px`).join(", ");

const FROST_LAYERS = ["0 0", "100% 0", "0 100%", "100% 100%"]
  .map((at) => `radial-gradient(220px 160px at ${at}, var(--bb-festive-frost), transparent)`)
  .join(", ");

/** The one full-window overlay node festive.ts appends while active. */
export const SKY_SELECTOR = "[data-bb-festive-sky]";

export const SHELL_CSS = `
/* Frost in the corners of the window. */
${SKY_SELECTOR} {
  position: fixed;
  inset: 0;
  z-index: 40;
  pointer-events: none;
  background: ${FROST_LAYERS};
}
/* Slow snow over the whole window; none at all under reduced motion. */
${SKY_SELECTOR} > [data-bb-festive-sky-snow] {
  display: none;
}
@media (prefers-reduced-motion: no-preference) {
  ${SKY_SELECTOR} > [data-bb-festive-sky-snow] {
    display: block;
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-color: var(--bb-festive-flake);
    -webkit-mask-image: ${SKY_SNOW_MASK_IMAGE};
    mask-image: ${SKY_SNOW_MASK_IMAGE};
    -webkit-mask-size: ${SKY_SNOW_MASK_SIZE};
    mask-size: ${SKY_SNOW_MASK_SIZE};
    -webkit-mask-repeat: repeat;
    mask-repeat: repeat;
    animation: bb-festive-sky-snow 60s linear infinite;
  }
}
@keyframes bb-festive-sky-snow {
  from { -webkit-mask-position: ${SKY_SNOW_FROM}; mask-position: ${SKY_SNOW_FROM}; }
  to { -webkit-mask-position: ${SKY_SNOW_TO}; mask-position: ${SKY_SNOW_TO}; }
}

/* The garland: scalloped wire with glowing bulbs along the window's top edge. */
${SKY_SELECTOR}::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: ${GARLAND_TILE.height}px;
  pointer-events: none;
  background: ${svgUrl(garlandSvg(false))} 0 0 / ${GARLAND_TILE.width}px ${GARLAND_TILE.height}px repeat-x;
}
@media (prefers-reduced-motion: no-preference) {
  ${SKY_SELECTOR}::after {
    background-image: ${svgUrl(garlandSvg(true))};
  }
}

/* Snow drift behind the footer controls: the footer becomes its own
   stacking context, so a negative z-index stays above the sidebar fill
   but below every button. */
${SIDEBAR_FOOTER} {
  position: relative;
  isolation: isolate;
}
${SIDEBAR_FOOTER}::before,
${SIDEBAR_FOOTER}::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 16px;
  z-index: -1;
  pointer-events: none;
  -webkit-mask: ${DRIFT_MASK} 0 0 / 100% 100% no-repeat;
  mask: ${DRIFT_MASK} 0 0 / 100% 100% no-repeat;
}
/* A soft rim of shadow peeking above the snow. */
${SIDEBAR_FOOTER}::before {
  bottom: 2px;
  background-color: var(--bb-festive-drift-shadow);
}
${SIDEBAR_FOOTER}::after {
  background: var(--bb-festive-drift);
}
`;

/* ---------- Winter scene behind the main pane ---------- */

/**
 * The scene is painted as fixed-attachment backgrounds on the surfaces that
 * paint the main pane: the inset itself and the opaque sticky composer
 * footer of a thread. Fixed attachment aligns the layers to the viewport,
 * so the two surfaces show one seamless picture behind all content.
 */
/** The inset, plus its (translucent) page headers so the sleigh flies behind their titles too. */
const MAIN_PANE = 'main[data-sidebar="inset"], :where(main[data-sidebar="inset"]) header';
const MAIN_FOOTER_COVER = ':where(main[data-sidebar="inset"]) [data-scroll-footer] > div';

const MOON = svgUrl(moonSvg());
const HILLS = svgUrl(hillsSvg());
const SNOWMAN = svgUrl(snowmanSvg());
const SLEIGH = svgUrl(sleighSvg());

/** Layers shared by every main-pane surface: snowman over hills. */
const GROUND = {
  image: `${SNOWMAN}, ${HILLS}`,
  position: "right 18px bottom 0, center bottom",
  size: "56px 70px, 100% auto",
};

function sceneCss(now: Date): string {
  const countdown = svgUrl(countdownSvg(countdownText(now)));
  const sky = {
    image: `${countdown}, ${MOON}`,
    position: `right 24px top 56px, calc(25% + 48px) 64px`,
    size: `${COUNTDOWN_BOX.width}px ${COUNTDOWN_BOX.height}px, 44px 44px`,
  };
  const sleigh = {
    image: SLEIGH,
    position: "0 6px",
    size: `${SLEIGH_BAND.width * 0.8}px ${SLEIGH_BAND.height * 0.8}px`,
  };
  const layers = (parts: Array<{ image: string; position: string; size: string }>) => `
  background-image: ${parts.map((p) => p.image).join(", ")};
  background-position: ${parts.map((p) => p.position).join(", ")};
  background-size: ${parts.map((p) => p.size).join(", ")};
  background-repeat: no-repeat;
  background-attachment: fixed;`;
  return `
${MAIN_PANE} {${layers([sky, GROUND])}
}
@media (prefers-reduced-motion: no-preference) {
  ${MAIN_PANE} {${layers([sleigh, sky, GROUND])}
  }
}
${MAIN_FOOTER_COVER} {${layers([GROUND])}
}
`;
}

export function festiveCss(now: Date): string {
  return `
:root {
  --bb-festive-hat: var(--destructive);
  --bb-festive-fur: color-mix(in oklch, var(--canvas) 94%, var(--ink));
  --bb-festive-snow: color-mix(in oklab, var(--timeline-accent) 45%, var(--canvas));
  --bb-festive-sparkle: color-mix(in oklab, var(--timeline-accent) 85%, var(--canvas));
  --bb-festive-star: var(--attention);
  --bb-festive-drift: linear-gradient(var(--canvas), color-mix(in oklab, var(--timeline-accent) 20%, var(--canvas)));
  --bb-festive-drift-shadow: color-mix(in oklab, var(--timeline-accent) 40%, transparent);
  --bb-festive-flake: color-mix(in oklab, var(--bb-festive-snow) 70%, transparent);
  --bb-festive-frost: color-mix(in oklab, var(--timeline-accent) 9%, transparent);
}
.dark {
  --bb-festive-fur: color-mix(in oklch, var(--ink) 94%, var(--canvas));
  /* Brighter than the ink-colored icon strokes so snow reads on top of them. */
  --bb-festive-snow: oklch(from color-mix(in oklab, var(--ink) 85%, var(--timeline-accent)) calc(l + 0.14) c h);
  --bb-festive-drift: linear-gradient(color-mix(in oklab, var(--ink) 82%, var(--timeline-accent)), color-mix(in oklab, var(--ink) 62%, var(--timeline-accent)));
  --bb-festive-drift-shadow: color-mix(in oklab, var(--timeline-accent) 40%, transparent);
  --bb-festive-flake: color-mix(in oklab, var(--bb-festive-snow) 45%, transparent);
  --bb-festive-frost: color-mix(in oklab, var(--bb-festive-snow) 10%, transparent);
}

${PROVIDER_ICON_HOST} {
  position: relative;
}
${PROVIDER_ICON_HOST}::before,
${PROVIDER_ICON_HOST}::after {
  content: "";
  position: absolute;
  left: 36%;
  top: -38%;
  width: 56%;
  height: 56%;
  pointer-events: none;
  transform: rotate(14deg);
  -webkit-mask: var(--bb-festive-mask) center / contain no-repeat;
  mask: var(--bb-festive-mask) center / contain no-repeat;
}
${PROVIDER_ICON_HOST}::before {
  --bb-festive-mask: ${HAT_RED_MASK};
  background-color: var(--bb-festive-hat);
}
${PROVIDER_ICON_HOST}::after {
  --bb-festive-mask: ${HAT_FUR_MASK};
  background-color: var(--bb-festive-fur);
}

${HOME_RAIL_BUTTON}::after {
  content: "";
  position: absolute;
  left: calc(50% - 8px);
  top: calc(50% - 9px);
  width: 16px;
  height: 8px;
  pointer-events: none;
  background-color: var(--bb-festive-snow);
  -webkit-mask: ${SNOW_CAP_MASK} center / contain no-repeat;
  mask: ${SNOW_CAP_MASK} center / contain no-repeat;
}

${NEW_THREAD_GLYPH} {
  box-sizing: content-box;
  padding: 4px;
  margin: -4px;
  background: ${cornerSparkle("var(--bb-festive-sparkle)", 6)};
}

${BB_LOGO_IMAGE} {
  box-sizing: content-box;
  padding: 3px;
  margin: -3px;
  background: ${cornerSparkle("var(--bb-festive-star)", 6)};
}
/* BbLogo inverts itself in dark mode; pre-invert the star so it stays gold. */
.dark ${BB_LOGO_IMAGE} {
  background: ${cornerSparkle("rgb(from var(--bb-festive-star) calc(255 - r) calc(255 - g) calc(255 - b))", 6)};
}

${RUNNING_SPINNER} {
  color: var(--success);
}

${SHELL_CSS}
[data-bb-festive-snow] {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  overflow: hidden;
  pointer-events: none;
}
[data-bb-festive-snow] > span {
  position: absolute;
  top: -12px;
  left: var(--x);
  width: var(--s);
  height: var(--s);
  border-radius: 9999px;
  background: var(--bb-festive-snow);
  opacity: var(--o);
  animation: bb-festive-fall var(--t) linear var(--d) both;
}
@keyframes bb-festive-fall {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(var(--drift), calc(100vh + 24px), 0); }
}

[data-bb-festive-toast] {
  position: fixed;
  left: 50%;
  bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
  z-index: 2147483000;
  transform: translateX(-50%);
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 9999px;
  background: var(--popover);
  color: var(--popover-foreground, var(--foreground));
  box-shadow: 0 4px 16px color-mix(in oklab, var(--ink) 14%, transparent);
  font: inherit;
  font-size: 0.8125rem;
  line-height: 1.25rem;
  white-space: nowrap;
  pointer-events: none;
}
@media (prefers-reduced-motion: no-preference) {
  [data-bb-festive-toast] {
    animation: bb-festive-toast 4s ease both;
  }
}
@keyframes bb-festive-toast {
  0% { opacity: 0; transform: translate(-50%, 8px); }
  8%, 88% { opacity: 1; transform: translate(-50%, 0); }
  100% { opacity: 0; transform: translate(-50%, 4px); }
}
${sceneCss(now)}`;
}

/** The stylesheet for today; festive.ts re-renders it at each midnight. */
export const FESTIVE_CSS = festiveCss(new Date());
