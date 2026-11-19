import { z } from "zod";
import {
  backdropGroundSchema,
  readBackdropImageId,
  toBackdropGround,
  type ClaudeBackdropGround,
  type ClaudeBackdropImage,
} from "./backdrop-ground.js";

export const BACKDROP_STATE_KIND = "bb/backdrop";

const BACKDROP_SURFACE = "desktop";
const BACKDROP_CLIENT_ID = "bb";
export const BACKDROP_COMPONENT = "Backdrop";
export const BACKDROP_INSTANCE_ID = "backdrop";
export const THEME_COMPONENT = "Theme";
export const THEME_INSTANCE_ID = "theme";

const MAX_DEPTH = 32;
const MAX_NODES = 2048;
const MAX_CHILDREN = 256;
const MAX_TEXT_CHARS = 4096;
const MAX_PROP_KEY_CHARS = 64;
const MAX_PROP_STRING_CHARS = 4096;
const MAX_SVG_SOURCE_CHARS = 60 * 1024;
const MAX_SVG_ALT_CHARS = 1024;
const MAX_SVG_DIMENSION = 4096;
const MAX_NAME_CHARS = 256;
const MAX_TINT_CHARS = 64;
const MAX_GLASS_BLUR = 64;
const DEFAULT_GLASS_BLUR = 16;
const DEFAULT_GLASS_OPACITY = 0.6;
const PUBLISH_INTERVAL_MS = 1000;
export const BACKDROP_MAX_PAYLOAD_BYTES = 64 * 1024;

const containerTypes = ["Box", "Text", "div", "span", "b"] as const;

type ClaudeBackdropContainerType = (typeof containerTypes)[number];

type ClaudeBackdropPropValue = string | number | boolean;

export type ClaudeBackdropNode =
  | {
      type: ClaudeBackdropContainerType;
      props: Record<string, ClaudeBackdropPropValue>;
      children: ClaudeBackdropChild[];
    }
  | {
      type: "Svg";
      source: string;
      alt: string;
      width: number | null;
      height: number | null;
    };

export type ClaudeBackdropChild = string | ClaudeBackdropNode;

export type ClaudeBackdropGlass = {
  blur: number;
  opacity: number;
  tint: string | null;
};

export type ClaudeBackdrop = {
  source: string;
  scene: string | null;
  colorScheme: "light" | "dark" | null;
  glass: ClaudeBackdropGlass | null;
  tree: ClaudeBackdropNode | null;
  ground: ClaudeBackdropGround | null;
};

export type ClaudeBackdropState = {
  backdrop: ClaudeBackdrop | null;
};

export type ClaudeBackdropConversion = {
  state: ClaudeBackdropState;
  treeDropped: boolean;
  groundDropped: boolean;
};

export type ClaudeBackdropReplies = {
  scene: unknown;
  theme: unknown;
  image: ClaudeBackdropImage | null;
};

export type ClaudeUiAttachRequest = {
  subtype: "ui_attach";
  surface: string;
  client_id: string;
  draws: string[];
};

export type ClaudeUiRenderRequest = {
  subtype: "ui_render";
  surface: string;
  client_id: string;
  component: string;
  instance_id: string;
  props: Record<string, never>;
};

export type ClaudeUiControlRequest =
  | ClaudeUiAttachRequest
  | ClaudeUiRenderRequest;

export function backdropAttachRequest(): ClaudeUiAttachRequest {
  return {
    subtype: "ui_attach",
    surface: BACKDROP_SURFACE,
    client_id: BACKDROP_CLIENT_ID,
    draws: [THEME_COMPONENT, BACKDROP_COMPONENT],
  };
}

export function backdropRenderRequest(
  component: string,
  instanceId: string,
): ClaudeUiRenderRequest {
  return {
    subtype: "ui_render",
    surface: BACKDROP_SURFACE,
    client_id: BACKDROP_CLIENT_ID,
    component,
    instance_id: instanceId,
    props: {},
  };
}

export function isSceneMovedToThemeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.startsWith("ui_render:") &&
    message.includes("Theme under instance_id backdrop")
  );
}

export class UnsupportedUiControlError extends Error {}

export function isUnsupportedUiControlError(error: unknown): boolean {
  if (error instanceof UnsupportedUiControlError) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    /^ui_(attach|render):/.test(message) ||
    message.includes("Unsupported control request subtype")
  );
}

export type BackdropPublishScheduler = {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
};

export const realBackdropPublishScheduler: BackdropPublishScheduler = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

export type BackdropPublisher = {
  offer(state: ClaudeBackdropState): void;
  close(): void;
};

export function createBackdropPublisher(args: {
  scheduler: BackdropPublishScheduler;
  send: (state: ClaudeBackdropState) => void;
}): BackdropPublisher {
  let published: string | null = null;
  let publishedAt: number | null = null;
  let pending: ClaudeBackdropState | null = null;
  let cancelPending: (() => void) | null = null;
  let closed = false;
  const publish = (state: ClaudeBackdropState): void => {
    const serialized = JSON.stringify(state);
    if (serialized === published) {
      return;
    }
    published = serialized;
    publishedAt = args.scheduler.now();
    args.send(state);
  };
  const flush = (): void => {
    cancelPending = null;
    const state = pending;
    pending = null;
    if (!closed && state !== null) {
      publish(state);
    }
  };
  return {
    offer(state) {
      if (closed) {
        return;
      }
      if (cancelPending !== null) {
        pending = state;
        return;
      }
      if (JSON.stringify(state) === published) {
        return;
      }
      const elapsed =
        publishedAt === null
          ? PUBLISH_INTERVAL_MS
          : args.scheduler.now() - publishedAt;
      if (elapsed >= PUBLISH_INTERVAL_MS) {
        publish(state);
        return;
      }
      pending = state;
      cancelPending = args.scheduler.schedule(
        flush,
        PUBLISH_INTERVAL_MS - elapsed,
      );
    },
    close() {
      closed = true;
      cancelPending?.();
      cancelPending = null;
      pending = null;
    },
  };
}

const uiInvalidateMessageSchema = z.object({
  type: z.literal("system"),
  subtype: z.literal("ui_invalidate"),
  event: z.literal("ui.render"),
  instances: z
    .array(z.object({ surface: z.string(), component: z.string() }))
    .optional()
    .catch(undefined),
});

export function invalidatesBackdrop(message: unknown): boolean {
  const parsed = uiInvalidateMessageSchema.safeParse(message);
  if (!parsed.success) {
    return false;
  }
  const { instances } = parsed.data;
  return (
    instances === undefined ||
    instances.some(
      (instance) =>
        instance.surface === BACKDROP_SURFACE &&
        (instance.component === BACKDROP_COMPONENT ||
          instance.component === THEME_COMPONENT),
    )
  );
}

const renderResponseSchema = z.object({
  tree: z.unknown().optional(),
  props: z.record(z.string(), z.unknown()).catch({}),
});

const themePropsSchema = z.object({
  plugin: z.string().trim().min(1).max(MAX_NAME_CHARS),
  overrideColorScheme: z.unknown().optional(),
  backdrop: z.unknown().optional(),
});

const backdropPropsSchema = z.object({
  plugin: z.string().trim().min(1).max(MAX_NAME_CHARS),
  scene: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NAME_CHARS)
    .optional()
    .catch(undefined),
  id: z.string().trim().min(1).max(MAX_NAME_CHARS).optional().catch(undefined),
  glass: z.unknown().optional(),
  colorScheme: z.unknown().optional(),
  overrideColorScheme: z.unknown().optional(),
});

const colorSchemeSchema = z.enum(["light", "dark"]);

const glassSchema = z.object({
  blur: z.number().optional().catch(undefined),
  opacity: z.number().optional().catch(undefined),
  tint: z
    .string()
    .trim()
    .min(1)
    .max(MAX_TINT_CHARS)
    .optional()
    .catch(undefined),
});

const containerNodeSchema = z.object({
  type: z.enum(containerTypes),
  props: z.record(z.string(), z.unknown()).optional().catch(undefined),
  children: z.array(z.unknown()).optional().catch(undefined),
});

const svgNodeSchema = z.object({
  type: z.literal("Svg"),
  props: z.object({
    source: z.string().min(1).max(MAX_SVG_SOURCE_CHARS),
    alt: z.string().catch(""),
    width: z.number().optional().catch(undefined),
    height: z.number().optional().catch(undefined),
  }),
});

const backdropNodeSchema: z.ZodType<ClaudeBackdropNode> = z.lazy(() =>
  z.union([
    z.object({
      type: z.enum(containerTypes),
      props: z.record(
        z.string().max(MAX_PROP_KEY_CHARS),
        z.union([
          z.string().max(MAX_PROP_STRING_CHARS),
          z.number(),
          z.boolean(),
        ]),
      ),
      children: z.array(backdropChildSchema).max(MAX_CHILDREN),
    }),
    z.object({
      type: z.literal("Svg"),
      source: z.string().min(1).max(MAX_SVG_SOURCE_CHARS),
      alt: z.string().max(MAX_SVG_ALT_CHARS),
      width: z.number().positive().max(MAX_SVG_DIMENSION).nullable(),
      height: z.number().positive().max(MAX_SVG_DIMENSION).nullable(),
    }),
  ]),
);

const backdropChildSchema: z.ZodType<ClaudeBackdropChild> = z.lazy(() =>
  z.union([z.string().max(MAX_TEXT_CHARS), backdropNodeSchema]),
);

function isWithinBackdropTreeLimits(value: unknown): boolean {
  const pending: Array<{ node: unknown; depth: number }> = [
    { node: value, depth: 1 },
  ];
  let nodes = 0;
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) {
      break;
    }
    if (typeof next.node !== "object" || next.node === null) {
      continue;
    }
    nodes += 1;
    if (nodes > MAX_NODES || next.depth > MAX_DEPTH) {
      return false;
    }
    const children: unknown = Reflect.get(next.node, "children");
    if (Array.isArray(children)) {
      for (const child of children) {
        pending.push({ node: child, depth: next.depth + 1 });
      }
    }
  }
  return true;
}

const backdropTreeSchema = z
  .custom<unknown>(isWithinBackdropTreeLimits)
  .pipe(backdropNodeSchema);

const backdropStateSchema = z.object({
  backdrop: z
    .object({
      source: z.string().min(1).max(MAX_NAME_CHARS),
      scene: z.string().min(1).max(MAX_NAME_CHARS).nullable(),
      colorScheme: colorSchemeSchema.nullable(),
      glass: z
        .object({
          blur: z.number().min(0).max(MAX_GLASS_BLUR),
          opacity: z.number().min(0).max(1),
          tint: z.string().min(1).max(MAX_TINT_CHARS).nullable(),
        })
        .nullable(),
      tree: backdropTreeSchema.nullable(),
      ground: backdropGroundSchema.nullable(),
    })
    .nullable(),
});

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toDimension(value: number | undefined): number | null {
  return value !== undefined &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_SVG_DIMENSION
    ? value
    : null;
}

function toProps(
  value: Record<string, unknown> | undefined,
): Record<string, ClaudeBackdropPropValue> {
  const props: Record<string, ClaudeBackdropPropValue> = {};
  for (const [key, prop] of Object.entries(value ?? {})) {
    if (key.length === 0 || key.length > MAX_PROP_KEY_CHARS) {
      continue;
    }
    if (
      (typeof prop === "string" && prop.length <= MAX_PROP_STRING_CHARS) ||
      typeof prop === "boolean" ||
      (typeof prop === "number" && Number.isFinite(prop))
    ) {
      props[key] = prop;
    }
  }
  return props;
}

interface NodeBudget {
  remaining: number;
}

function toChild(
  value: unknown,
  depth: number,
  budget: NodeBudget,
): ClaudeBackdropChild | null {
  if (typeof value === "string") {
    return value.slice(0, MAX_TEXT_CHARS);
  }
  return toNode(value, depth, budget);
}

function toNode(
  value: unknown,
  depth: number,
  budget: NodeBudget,
): ClaudeBackdropNode | null {
  if (depth > MAX_DEPTH || budget.remaining <= 0) {
    return null;
  }
  const svg = svgNodeSchema.safeParse(value);
  if (svg.success) {
    budget.remaining -= 1;
    return {
      type: "Svg",
      source: svg.data.props.source,
      alt: svg.data.props.alt.slice(0, MAX_SVG_ALT_CHARS),
      width: toDimension(svg.data.props.width),
      height: toDimension(svg.data.props.height),
    };
  }
  const container = containerNodeSchema.safeParse(value);
  if (!container.success) {
    return null;
  }
  budget.remaining -= 1;
  const children: ClaudeBackdropChild[] = [];
  for (const entry of container.data.children ?? []) {
    if (children.length >= MAX_CHILDREN) {
      break;
    }
    const child = toChild(entry, depth + 1, budget);
    if (child !== null) {
      children.push(child);
    }
  }
  return {
    type: container.data.type,
    props: toProps(container.data.props),
    children,
  };
}

function toGlass(value: unknown): ClaudeBackdropGlass | null {
  const glass = glassSchema.safeParse(value);
  if (!glass.success) {
    return null;
  }
  return {
    blur: clamp(glass.data.blur ?? DEFAULT_GLASS_BLUR, 0, MAX_GLASS_BLUR),
    opacity: clamp(glass.data.opacity ?? DEFAULT_GLASS_OPACITY, 0, 1),
    tint: glass.data.tint ?? null,
  };
}

function toColorScheme(props: {
  colorScheme?: unknown;
  overrideColorScheme?: unknown;
}): ClaudeBackdrop["colorScheme"] {
  const override = colorSchemeSchema.safeParse(props.overrideColorScheme);
  if (override.success) {
    return override.data;
  }
  const direct = colorSchemeSchema.safeParse(props.colorScheme);
  return direct.success ? direct.data : null;
}

function isPublishable(state: ClaudeBackdropState): boolean {
  return (
    backdropStateSchema.safeParse(state).success &&
    Buffer.byteLength(JSON.stringify(state)) <= BACKDROP_MAX_PAYLOAD_BYTES
  );
}

function readThemeProps(
  theme: unknown,
): z.infer<typeof themePropsSchema> | null {
  const reply = renderResponseSchema.safeParse(theme);
  if (!reply.success) {
    return null;
  }
  const props = themePropsSchema.safeParse(reply.data.props);
  return props.success ? props.data : null;
}

export function readThemeImageId(theme: unknown): string | null {
  const props = readThemeProps(theme);
  return props === null ? null : readBackdropImageId(props.backdrop);
}

function sceneBackdrop(scene: unknown): ClaudeBackdrop | null {
  const reply = renderResponseSchema.safeParse(scene);
  if (!reply.success) {
    return null;
  }
  const props = backdropPropsSchema.safeParse(reply.data.props);
  if (!props.success) {
    return null;
  }
  const name = props.data.scene ?? props.data.id;
  if (name === undefined) {
    return null;
  }
  return {
    source: props.data.plugin,
    scene: name,
    colorScheme: toColorScheme(props.data),
    glass: toGlass(props.data.glass),
    tree: toNode(reply.data.tree, 1, { remaining: MAX_NODES }),
    ground: null,
  };
}

function groundBackdrop(
  theme: unknown,
  image: ClaudeBackdropImage | null,
): ClaudeBackdrop | null {
  const props = readThemeProps(theme);
  if (props === null) {
    return null;
  }
  const ground = toBackdropGround(props.backdrop, image);
  const colorScheme = toColorScheme(props);
  if (ground === null && colorScheme === null) {
    return null;
  }
  return {
    source: props.plugin,
    scene: null,
    colorScheme,
    glass: null,
    tree: null,
    ground,
  };
}

export function toBackdropState(
  replies: ClaudeBackdropReplies,
): ClaudeBackdropConversion {
  const empty: ClaudeBackdropConversion = {
    state: { backdrop: null },
    treeDropped: false,
    groundDropped: false,
  };
  const backdrop =
    sceneBackdrop(replies.scene) ??
    groundBackdrop(replies.theme, replies.image);
  if (backdrop === null) {
    return empty;
  }
  const state: ClaudeBackdropState = { backdrop };
  if (isPublishable(state)) {
    return { ...empty, state };
  }
  const treeless: ClaudeBackdrop = { ...backdrop, tree: null };
  if (isPublishable({ backdrop: treeless })) {
    return { ...empty, state: { backdrop: treeless }, treeDropped: true };
  }
  const bare: ClaudeBackdrop = { ...treeless, ground: null };
  return isPublishable({ backdrop: bare })
    ? {
        state: { backdrop: bare },
        treeDropped: backdrop.tree !== null,
        groundDropped: backdrop.ground !== null,
      }
    : empty;
}
