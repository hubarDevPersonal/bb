/**
 * The winter scene behind the main pane, ported from the Claude Code
 * "new-year" mod: a twinkling garland, Santa's sleigh, a crescent moon,
 * snowy hills with pines and a cabin, a snowman, and a countdown.
 *
 * Everything is an SVG painted as a CSS background, so it sits behind the
 * app's content and never takes pointer events. SVG colors are fixed values
 * chosen to read on both the frosty light and the near-black dark canvas.
 */

function rand(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

const svg = (viewBox: string, body: string, attrs = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${attrs}>${body}</svg>`;

export function svgUrl(source: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(source)}")`;
}

// ---- Garland ---------------------------------------------------------------

/** One repeatable stretch of garland: four scallops, eight bulbs, four colors. */
export const GARLAND_TILE = { width: 640, height: 26 } as const;
const GARLAND_SPAN = GARLAND_TILE.width / 4;
const GARLAND_COLORS = ["#f2c063", "#e0745f", "#f2c063", "#8fc1a3"];
const GARLAND_TOP = 3;
const GARLAND_DIP = 10;

export function garlandSvg(animated: boolean): string {
  let wire = `M0 ${GARLAND_TOP}`;
  const bulbs: string[] = [];
  for (let x = 0, i = 0; x < GARLAND_TILE.width; x += GARLAND_SPAN, i += 1) {
    wire += ` Q${x + GARLAND_SPAN / 2} ${GARLAND_TOP + GARLAND_DIP * 2} ${x + GARLAND_SPAN} ${GARLAND_TOP}`;
    for (const t of [0.3, 0.7]) {
      const bx = (x + GARLAND_SPAN * t).toFixed(1);
      const by = (GARLAND_TOP + 2 * (1 - t) * t * GARLAND_DIP * 2 + 4).toFixed(1);
      const color = GARLAND_COLORS[(i * 2 + (t > 0.5 ? 1 : 0)) % GARLAND_COLORS.length]!;
      const delay = (((i * 7 + (t > 0.5 ? 3 : 0)) % 10) * 0.37).toFixed(2);
      bulbs.push(
        `<g class="b" style="animation-delay:${delay}s"><circle cx="${bx}" cy="${by}" r="7.5" fill="url(#g${color.slice(1)})"/><circle cx="${bx}" cy="${by}" r="3.5" fill="${color}"/></g>`,
      );
    }
  }
  const glows = [...new Set(GARLAND_COLORS)]
    .map(
      (c) =>
        `<radialGradient id="g${c.slice(1)}"><stop offset="0" stop-color="${c}" stop-opacity="0.55"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`,
    )
    .join("");
  const style = animated
    ? "<style>.b{animation:t 3.6s ease-in-out infinite}@keyframes t{0%,100%{opacity:1}50%{opacity:.45}}</style>"
    : "";
  return svg(
    `0 0 ${GARLAND_TILE.width} ${GARLAND_TILE.height}`,
    `<defs>${glows}</defs>${style}<path d="${wire}" fill="none" stroke="#8c97a8" stroke-width="1" opacity="0.6"/>${bulbs.join("")}`,
  );
}

// ---- Santa's sleigh --------------------------------------------------------

export const SLEIGH_CYCLE_S = 45;
/** Wide enough that the flight clears the right edge of large windows. */
export const SLEIGH_BAND = { width: 2400, height: 80 } as const;

export function sleighSvg(): string {
  const fur = "#8a6a50";
  const deer = (x: number, nose: string) =>
    `<g transform="translate(${x} 0)">` +
    // legs mid-gallop
    `<path d="M3 33 l-4 9 M7 34 l-1 9 M17 33 l4 8 M21 32 l6 7" stroke="${fur}" stroke-width="2" stroke-linecap="round"/>` +
    // body, neck, head
    `<ellipse cx="12" cy="30" rx="12" ry="5.5" fill="${fur}"/>` +
    `<path d="M20 28 l6 -9 l4 1 l-4 9z" fill="${fur}"/>` +
    `<ellipse cx="30" cy="18.5" rx="4.6" ry="3" fill="${fur}"/>` +
    // antlers
    `<path d="M27 16 l-3 -7 m1.5 3.5 l-4 -1 M30 15.5 l1 -7 m-0.5 3.5 l3.5 -2" fill="none" stroke="#6b5240" stroke-width="1.4" stroke-linecap="round"/>` +
    `<circle cx="34.4" cy="18.6" r="1.7" fill="${nose}"/>` +
    `</g>`;
  const team = [deer(0, "#e0453a"), deer(38, "#4a3a30"), deer(76, "#4a3a30")].join("");
  const reins = `<path d="M34 19 Q80 30 118 22 M72 19 Q100 28 128 26" fill="none" stroke="#c8a465" stroke-width="1" opacity="0.9"/>`;
  const sleigh =
    `<g transform="translate(124 4)">` +
    // sack of presents
    `<path d="M40 22 q2 -14 12 -12 q8 2 6 16z" fill="#7b5a3c"/>` +
    // Santa: red suit, white trim, beard, hat with pompom
    `<path d="M14 30 q0 -16 12 -16 q12 0 12 16z" fill="#d1453b"/>` +
    `<rect x="14" y="27" width="24" height="3" fill="#f4f6fa"/>` +
    `<circle cx="26" cy="11" r="6" fill="#f1c9a5"/>` +
    `<path d="M20 12 q6 10 12 0 q0 6 -6 8 q-6 -2 -6 -8z" fill="#f4f6fa"/>` +
    `<path d="M19.5 8 q6 -10 14 -2 l3 4 l-3 0 q-5 -3 -14 -1z" fill="#d1453b"/>` +
    `<circle cx="36.5" cy="10" r="2" fill="#f4f6fa"/>` +
    `<rect x="19" y="6.5" width="14" height="2.6" rx="1.3" fill="#f4f6fa"/>` +
    // sleigh body and runner
    `<path d="M4 28 h44 q8 0 8 -12 l4 0 q0 22 -14 24 h-34 q-8 0 -8 -12z" fill="#b8322c"/>` +
    `<path d="M2 46 h52 q8 0 10 -8" fill="none" stroke="#c8a465" stroke-width="2.2" stroke-linecap="round"/>` +
    `<path d="M14 40 v6 M42 40 v6" stroke="#c8a465" stroke-width="1.6"/>` +
    `</g>`;
  const start = -260;
  const end = SLEIGH_BAND.width + 60;
  const style =
    `<style>.s{animation:f ${SLEIGH_CYCLE_S}s linear infinite;transform:translate(${start}px,18px)}` +
    `@keyframes f{0%{transform:translate(${start}px,22px)}15%{transform:translate(${(start + end) / 2}px,10px)}30%{transform:translate(${end}px,4px)}100%{transform:translate(${end}px,4px)}}</style>`;
  return svg(
    `0 0 ${SLEIGH_BAND.width} ${SLEIGH_BAND.height}`,
    `${style}<g class="s">${team}${reins}${sleigh}</g>`,
  );
}

// ---- Moon, hills, snowman ----------------------------------------------------

export function moonSvg(): string {
  return svg(
    "0 0 48 48",
    `<defs><radialGradient id="g"><stop offset="0" stop-color="#f6e7b8" stop-opacity="0.45"/><stop offset="1" stop-color="#f6e7b8" stop-opacity="0"/></radialGradient><mask id="m"><rect width="48" height="48" fill="#fff"/><circle cx="30" cy="19" r="11" fill="#000"/></mask></defs><circle cx="24" cy="24" r="24" fill="url(#g)"/><circle cx="24" cy="24" r="12" fill="#f3e3b0" mask="url(#m)"/>`,
  );
}

function pine(x: number, base: number, h: number, opacity: string): string {
  const w = h * 0.42;
  const tiers = [0, 0.3, 0.58]
    .map((t, i) => {
      const top = base - h + h * t;
      const half = w * (0.55 + i * 0.22);
      const bottom = top + h * 0.46;
      return `M${(x - half).toFixed(1)} ${bottom.toFixed(1)}L${x.toFixed(1)} ${top.toFixed(1)}L${(x + half).toFixed(1)} ${bottom.toFixed(1)}Z`;
    })
    .join("");
  return `<path d="${tiers}" fill="#5f7f74" opacity="${opacity}"/><rect x="${(x - 1.6).toFixed(1)}" y="${(base - 4).toFixed(1)}" width="3.2" height="6" fill="#6b5a4a" opacity="${opacity}"/>`;
}

export const HILLS_VIEWBOX = { width: 1600, height: 170 } as const;

export function hillsSvg(): string {
  const r = rand(1225);
  const pines: string[] = [];
  for (const [from, to, n] of [
    [60, 300, 3],
    [300, 560, 6],
    [1040, 1300, 6],
    [1300, 1540, 3],
    [640, 960, 2],
  ] as const) {
    for (let i = 0; i < n; i += 1) {
      const x = from + ((to - from) * (i + 0.2 + r() * 0.6)) / n;
      const base = 128 + Math.sin(x / 140) * 8;
      pines.push(pine(x, base, 26 + r() * 30, (from === 640 ? 0.22 : 0.38 + r() * 0.15).toFixed(2)));
    }
  }
  const cabin = `<g transform="translate(1180 104)" opacity="0.8"><path d="M0 18 L14 6 L28 18 V34 H0Z" fill="#7a6a5c"/><path d="M-3 19 L14 4 L31 19" fill="none" stroke="#e9eef5" stroke-width="3" stroke-linecap="round"/><rect x="10" y="21" width="8" height="7" fill="#f2c063"/><circle cx="14" cy="24" r="10" fill="#f2c063" opacity="0.22"/></g>`;
  return svg(
    `0 0 ${HILLS_VIEWBOX.width} ${HILLS_VIEWBOX.height}`,
    `<path d="M0 120 C200 80 380 100 560 110 S960 70 1180 100 S1480 90 1600 96 V170 H0Z" fill="#8fa6c4" opacity="0.14"/>${pines.join("")}${cabin}<path d="M0 140 C240 112 460 132 700 136 S1140 112 1360 128 S1540 126 1600 122 V170 H0Z" fill="#c3d1e3" opacity="0.3"/><path d="M0 140 C240 112 460 132 700 136 S1140 112 1360 128 S1540 126 1600 122" fill="none" stroke="#9fb3cf" stroke-width="1.2" opacity="0.5"/>`,
    ' preserveAspectRatio="xMidYMax slice"',
  );
}

export function snowmanSvg(): string {
  return svg(
    "0 0 64 80",
    `<g stroke="#b8c3d3" stroke-width="1.2"><circle cx="32" cy="58" r="20" fill="#f4f6fa"/><circle cx="32" cy="28" r="13" fill="#f4f6fa"/></g><path d="M20 38 q12 7 24 0 l1 5 q-13 6 -26 0z" fill="#c85a50"/><path d="M42 40 l6 12 l-5 1z" fill="#c85a50"/><rect x="22" y="10" width="20" height="4" rx="1" fill="#3a3f4a"/><rect x="25" y="1" width="14" height="10" rx="1" fill="#3a3f4a"/><circle cx="27" cy="25" r="1.4" fill="#3a3f4a"/><circle cx="37" cy="25" r="1.4" fill="#3a3f4a"/><path d="M32 29 l9 2 l-9 1.6z" fill="#ee8a3c"/><circle cx="32" cy="52" r="1.4" fill="#3a3f4a"/><circle cx="32" cy="60" r="1.4" fill="#3a3f4a"/>`,
  );
}

// ---- Countdown ---------------------------------------------------------------

export function daysWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "день";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "дня";
  return "дней";
}

export function countdownText(now: Date): string {
  const month = now.getMonth();
  const day = now.getDate();
  if (month === 0 && day <= 14) return `С Новым ${now.getFullYear()}! ✨`;
  if (month === 11 && day === 31) return "Новый год сегодня 🥂";
  const next = new Date(now.getFullYear() + 1, 0, 1);
  const today = new Date(now.getFullYear(), month, day);
  const left = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  return `до Нового года ${left} ${daysWord(left)}`;
}

export const COUNTDOWN_BOX = { width: 260, height: 20 } as const;

export function countdownSvg(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return svg(
    `0 0 ${COUNTDOWN_BOX.width} ${COUNTDOWN_BOX.height}`,
    `<text x="${COUNTDOWN_BOX.width}" y="14" text-anchor="end" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif" font-size="12.5" fill="#8b93a1">${escaped}</text>`,
  );
}
