import type { CSSProperties } from "react";

type ThreadBackdropProps = Readonly<Record<string, string | number | boolean>>;
type LengthAxis = "inline" | "block";

const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNCTIONAL_COLOR_PATTERN = /^(?:rgba?|hsla?)\((?:[\d.\s,%/+-]|deg)+\)$/i;
const CSS_LENGTH_PATTERN =
  /^-?\d+(?:\.\d+)?(?:%|px|ch|em|rem|lh|vh|vw|vmin|vmax|cqw|cqh)$/;
const CELL_COUNT_PATTERN = /^-?\d+(?:\.\d+)?$/;

const CSS_NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black " +
    "blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse " +
    "chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan " +
    "darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta " +
    "darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet " +
    "deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite " +
    "forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green " +
    "greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender " +
    "lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink " +
    "lightsalmon lightseagreen lightskyblue lightslategray lightslategrey " +
    "lightsteelblue lightyellow lime limegreen linen magenta maroon " +
    "mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen " +
    "mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive " +
    "olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise " +
    "palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown " +
    "seagreen seashell sienna silver skyblue slateblue slategray slategrey " +
    "snow springgreen steelblue tan teal thistle tomato turquoise violet " +
    "wheat white whitesmoke yellow yellowgreen transparent"
  ).split(" "),
);

const THEME_COLOR_VARIABLES: ReadonlyMap<string, string> = new Map([
  ["text", "var(--foreground)"],
  ["secondaryText", "var(--muted-foreground)"],
  ["inactive", "var(--muted-foreground)"],
  ["subtle", "var(--muted-foreground)"],
  ["background", "var(--background)"],
  ["border", "var(--border)"],
  ["claude", "var(--primary)"],
  ["success", "var(--success)"],
  ["error", "var(--destructive)"],
  ["warning", "var(--warning)"],
  ["permission", "var(--attention)"],
  ["surface-0", "var(--background)"],
  ["surface-1", "var(--surface-raised-solid)"],
  ["surface-2", "var(--surface-recessed-solid)"],
  ["surface-3", "var(--muted)"],
  ["text-primary", "var(--foreground)"],
  ["text-secondary", "var(--muted-foreground)"],
  ["text-muted", "var(--subtle-foreground)"],
  ["text-disabled", "color-mix(in oklab, var(--ink) 40%, transparent)"],
  ["fill-primary", "var(--primary)"],
  ["on-primary", "var(--primary-foreground)"],
  ["border-strong", "var(--input)"],
  ["border-stronger", "color-mix(in oklch, var(--ink) 45%, var(--canvas))"],
  ...semanticThemeColors("accent", "var(--timeline-accent)", {
    text: "var(--timeline-accent)",
    on: "var(--canvas)",
  }),
  ...semanticThemeColors("danger", "var(--destructive)", {
    text: "var(--destructive-text)",
    on: "var(--destructive-foreground)",
  }),
  ...semanticThemeColors("success", "var(--success)", {
    text: "var(--success-foreground)",
    on: "var(--canvas)",
  }),
  ...semanticThemeColors("warning", "var(--warning)", {
    text: "var(--warning-text)",
    on: "var(--canvas)",
  }),
  ...semanticThemeColors("pro", "var(--palette-purple)", {
    text: "var(--palette-purple)",
    on: "var(--canvas)",
  }),
]);

function semanticThemeColors(
  family: string,
  fill: string,
  { text, on }: { text: string; on: string },
): Array<[string, string]> {
  return [
    [`fill-${family}`, fill],
    [`text-${family}`, text],
    [`bg-${family}`, `color-mix(in oklab, ${fill} 14%, transparent)`],
    [`on-${family}`, on],
    [`border-${family}`, `color-mix(in oklab, ${fill} 40%, transparent)`],
  ];
}

const SPACING_STEPS: ReadonlyMap<string, string> = new Map([
  ["xs", "0.25rem"],
  ["sm", "0.5rem"],
  ["md", "0.75rem"],
  ["lg", "1rem"],
  ["xl", "1.5rem"],
]);

const FLEX_DIRECTIONS = [
  "row",
  "column",
  "row-reverse",
  "column-reverse",
] as const;
const JUSTIFY_CONTENT = [
  "flex-start",
  "flex-end",
  "center",
  "space-between",
  "space-around",
  "space-evenly",
] as const;
const ALIGN_ITEMS = [
  "flex-start",
  "flex-end",
  "center",
  "stretch",
  "baseline",
] as const;
const FLEX_WRAP = ["wrap", "nowrap", "wrap-reverse"] as const;
const OVERFLOW = ["visible", "hidden"] as const;
const DISPLAY = ["flex", "none", "block"] as const;
const POSITION = ["absolute", "relative"] as const;

const SINGLE_BORDER: CSSProperties = { borderStyle: "solid", borderWidth: 1 };
const DOUBLE_BORDER: CSSProperties = { borderStyle: "double", borderWidth: 3 };
const BORDER_STYLES: ReadonlyMap<string, CSSProperties> = new Map([
  ["single", SINGLE_BORDER],
  ["classic", SINGLE_BORDER],
  ["arrow", SINGLE_BORDER],
  ["round", { ...SINGLE_BORDER, borderRadius: "0.5rem" }],
  ["bold", { borderStyle: "solid", borderWidth: 2 }],
  ["double", DOUBLE_BORDER],
  ["singleDouble", DOUBLE_BORDER],
  ["doubleSingle", DOUBLE_BORDER],
  ["dashed", { borderStyle: "dashed", borderWidth: 1 }],
  ["quote", { borderLeftStyle: "solid", borderLeftWidth: 3 }],
]);

const TEXT_SIZE_CLASSES: ReadonlyMap<string, string> = new Map([
  ["caption", "text-xs"],
  ["footnote", "text-sm"],
  ["body", "text-base"],
  ["heading", "text-lg"],
  ["title", "text-2xl"],
]);
const TEXT_WEIGHT_CLASSES: ReadonlyMap<string, string> = new Map([
  ["regular", "font-normal"],
  ["medium", "font-medium"],
  ["semibold", "font-semibold"],
  ["bold", "font-bold"],
]);
const TRUNCATE_WRAPS = new Set([
  "truncate",
  "truncate-start",
  "truncate-middle",
  "truncate-end",
]);

export function resolveThreadBackdropColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const themeColor = THEME_COLOR_VARIABLES.get(trimmed);
  if (themeColor !== undefined) return themeColor;
  if (HEX_COLOR_PATTERN.test(trimmed)) return trimmed;
  if (FUNCTIONAL_COLOR_PATTERN.test(trimmed)) return trimmed;
  const lowered = trimmed.toLowerCase();
  return CSS_NAMED_COLORS.has(lowered) ? lowered : undefined;
}

function cells(count: number, axis: LengthAxis): string | undefined {
  if (!Number.isFinite(count)) return undefined;
  return `${count}${axis === "inline" ? "ch" : "lh"}`;
}

function resolveLength(
  value: string | number | boolean | undefined,
  axis: LengthAxis,
): string | undefined {
  if (typeof value === "number") return cells(value, axis);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "auto") return trimmed;
  if (CELL_COUNT_PATTERN.test(trimmed)) return cells(Number(trimmed), axis);
  return CSS_LENGTH_PATTERN.test(trimmed) ? trimmed : undefined;
}

function resolveSpacing(
  value: string | number | boolean | undefined,
  axis: LengthAxis,
): string | undefined {
  if (typeof value === "string") {
    const step = SPACING_STEPS.get(value.trim());
    if (step !== undefined) return step;
  }
  return resolveLength(value, axis);
}

function enumValue<T extends string>(
  props: ThreadBackdropProps,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = props[key];
  return allowed.find((candidate) => candidate === value);
}

function finiteNumber(
  props: ThreadBackdropProps,
  key: string,
): number | undefined {
  const value = props[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function assignDefined(style: CSSProperties, entries: CSSProperties): void {
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) {
      Object.assign(style, { [key]: value });
    }
  }
}

function spacingStyle(
  props: ThreadBackdropProps,
  kind: "padding" | "margin",
): CSSProperties {
  const all = props[kind];
  const x = props[`${kind}X`] ?? all;
  const y = props[`${kind}Y`] ?? all;
  const side = (name: "Top" | "Bottom" | "Left" | "Right") => {
    const axis: LengthAxis =
      name === "Left" || name === "Right" ? "inline" : "block";
    const fallback = axis === "inline" ? x : y;
    return resolveSpacing(props[`${kind}${name}`] ?? fallback, axis);
  };
  return {
    [`${kind}Top`]: side("Top"),
    [`${kind}Bottom`]: side("Bottom"),
    [`${kind}Left`]: side("Left"),
    [`${kind}Right`]: side("Right"),
  };
}

export function threadBackdropBoxStyle(
  props: ThreadBackdropProps,
  defaultDisplay: "flex" | "block",
): CSSProperties {
  const display = enumValue(props, "display", DISPLAY) ?? defaultDisplay;
  const style: CSSProperties = {
    display,
    position: "relative",
    minWidth: 0,
    minHeight: 0,
  };
  const borderStyle =
    typeof props.borderStyle === "string"
      ? BORDER_STYLES.get(props.borderStyle)
      : undefined;
  assignDefined(style, {
    flexDirection: enumValue(props, "flexDirection", FLEX_DIRECTIONS),
    justifyContent: enumValue(props, "justifyContent", JUSTIFY_CONTENT),
    alignItems: enumValue(props, "alignItems", ALIGN_ITEMS),
    alignSelf: enumValue(props, "alignSelf", ALIGN_ITEMS),
    flexWrap: enumValue(props, "flexWrap", FLEX_WRAP),
    flexGrow: finiteNumber(props, "flexGrow"),
    flexShrink: finiteNumber(props, "flexShrink"),
    flexBasis: resolveLength(props.flexBasis, "inline"),
    columnGap: resolveSpacing(props.columnGap ?? props.gap, "inline"),
    rowGap: resolveSpacing(props.rowGap ?? props.gap, "block"),
    width: resolveLength(props.width, "inline"),
    minWidth: resolveLength(props.minWidth, "inline"),
    maxWidth: resolveLength(props.maxWidth, "inline"),
    height: resolveLength(props.height, "block"),
    minHeight: resolveLength(props.minHeight, "block"),
    maxHeight: resolveLength(props.maxHeight, "block"),
    position: enumValue(props, "position", POSITION),
    top: resolveLength(props.top, "block"),
    bottom: resolveLength(props.bottom, "block"),
    left: resolveLength(props.left, "inline"),
    right: resolveLength(props.right, "inline"),
    overflow: enumValue(props, "overflow", OVERFLOW),
    backgroundColor: resolveThreadBackdropColor(props.backgroundColor),
    ...spacingStyle(props, "padding"),
    ...spacingStyle(props, "margin"),
  });
  if (borderStyle !== undefined) {
    Object.assign(style, borderStyle, {
      borderColor:
        resolveThreadBackdropColor(props.borderColor) ?? "var(--border)",
    });
  }
  return style;
}

export interface ThreadBackdropTextPresentation {
  className: string[];
  style: CSSProperties;
}

export function threadBackdropTextPresentation(
  props: ThreadBackdropProps,
): ThreadBackdropTextPresentation {
  const className: string[] = [];
  const style: CSSProperties = {};
  let color = resolveThreadBackdropColor(props.color);
  let backgroundColor = resolveThreadBackdropColor(props.backgroundColor);
  if (props.inverse === true) {
    [color, backgroundColor] = [
      backgroundColor ?? "var(--background)",
      color ?? "var(--foreground)",
    ];
  }
  const decorations = [
    props.underline === true ? "underline" : null,
    props.strikethrough === true ? "line-through" : null,
  ].filter((decoration) => decoration !== null);
  assignDefined(style, {
    color,
    backgroundColor,
    textDecorationLine:
      decorations.length > 0 ? decorations.join(" ") : undefined,
  });
  const sizeClass =
    typeof props.size === "string" ? TEXT_SIZE_CLASSES.get(props.size) : null;
  const weightClass =
    typeof props.weight === "string"
      ? TEXT_WEIGHT_CLASSES.get(props.weight)
      : props.bold === true
        ? "font-semibold"
        : null;
  if (sizeClass) className.push(sizeClass);
  if (weightClass) className.push(weightClass);
  if (props.italic === true) className.push("italic");
  if (props.dimColor === true) className.push("opacity-60");
  if (props.mono === true) className.push("font-mono");
  if (props.tabular === true) className.push("tabular-nums");
  className.push(
    typeof props.wrap === "string" && TRUNCATE_WRAPS.has(props.wrap)
      ? "truncate"
      : "whitespace-pre-wrap",
  );
  return { className, style };
}

export function threadBackdropGlassFill(
  tint: string | null,
  opacity: number,
): string {
  const percent = Math.round(Math.min(Math.max(opacity, 0), 1) * 1000) / 10;
  const base =
    (tint === null ? undefined : resolveThreadBackdropColor(tint)) ??
    "var(--canvas)";
  return `color-mix(in oklab, ${base} ${percent}%, transparent)`;
}
