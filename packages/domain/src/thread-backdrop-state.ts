import { z } from "zod";
import type { ExtensionKind } from "./provider-extension-kind.js";

export const THREAD_BACKDROP_STATE_KIND = "bb/backdrop" satisfies ExtensionKind;

export const THREAD_BACKDROP_MAX_DEPTH = 32;
export const THREAD_BACKDROP_MAX_NODES = 2048;
export const THREAD_BACKDROP_SVG_MAX_CHARS = 60 * 1024;

export const threadBackdropContainerTypeSchema = z.enum([
  "Box",
  "Text",
  "div",
  "span",
  "b",
]);
export type ThreadBackdropContainerType = z.infer<
  typeof threadBackdropContainerTypeSchema
>;

export const threadBackdropPropValueSchema = z.union([
  z.string().max(4096),
  z.number(),
  z.boolean(),
]);

export type ThreadBackdropContainerNode = {
  type: ThreadBackdropContainerType;
  props: Record<string, string | number | boolean>;
  children: ThreadBackdropChild[];
};

export type ThreadBackdropSvgNode = {
  type: "Svg";
  source: string;
  alt: string;
  width: number | null;
  height: number | null;
};

export type ThreadBackdropNode =
  | ThreadBackdropContainerNode
  | ThreadBackdropSvgNode;

export type ThreadBackdropChild = string | ThreadBackdropNode;

export const threadBackdropSvgNodeSchema = z.object({
  type: z.literal("Svg"),
  source: z.string().min(1).max(THREAD_BACKDROP_SVG_MAX_CHARS),
  alt: z.string().max(1024),
  width: z.number().positive().max(4096).nullable(),
  height: z.number().positive().max(4096).nullable(),
});

export const threadBackdropNodeSchema: z.ZodType<ThreadBackdropNode> = z.lazy(
  () =>
    z.union([
      z.object({
        type: threadBackdropContainerTypeSchema,
        props: z.record(z.string().max(64), threadBackdropPropValueSchema),
        children: z.array(threadBackdropChildSchema).max(256),
      }),
      threadBackdropSvgNodeSchema,
    ]),
);

export const threadBackdropChildSchema: z.ZodType<ThreadBackdropChild> = z.lazy(
  () => z.union([z.string().max(4096), threadBackdropNodeSchema]),
);

export function isWithinThreadBackdropTreeLimits(value: unknown): boolean {
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
    if (nodes > THREAD_BACKDROP_MAX_NODES) {
      return false;
    }
    if (next.depth > THREAD_BACKDROP_MAX_DEPTH) {
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

export const threadBackdropTreeSchema = z
  .custom<unknown>(isWithinThreadBackdropTreeLimits, {
    message: `backdrop tree exceeds ${THREAD_BACKDROP_MAX_DEPTH} levels or ${THREAD_BACKDROP_MAX_NODES} nodes`,
  })
  .pipe(threadBackdropNodeSchema);

export const threadBackdropGlassSchema = z.object({
  blur: z.number().min(0).max(64),
  opacity: z.number().min(0).max(1),
  tint: z.string().min(1).max(64).nullable(),
});
export type ThreadBackdropGlass = z.infer<typeof threadBackdropGlassSchema>;

export const threadBackdropColorSchemeSchema = z.enum(["light", "dark"]);
export type ThreadBackdropColorScheme = z.infer<
  typeof threadBackdropColorSchemeSchema
>;

export const THREAD_BACKDROP_IMAGE_MAX_BASE64_CHARS = 56 * 1024;

export const threadBackdropColorSchema = z.string().min(1).max(64);

export const threadBackdropTilingShape = {
  size: z
    .tuple([z.number().min(1).max(256), z.number().min(1).max(256)])
    .nullable(),
  repeat: z.boolean(),
};

export const threadBackdropGroundSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("color"),
    color: threadBackdropColorSchema,
  }),
  z.object({
    type: z.literal("gradient"),
    stops: z
      .array(
        z.object({
          at: z.number().min(0).max(1).nullable(),
          color: threadBackdropColorSchema,
        }),
      )
      .min(2)
      .max(16),
    angle: z.number().min(-360).max(360),
    shape: z.enum(["linear", "radial"]),
    ...threadBackdropTilingShape,
  }),
  z.object({
    type: z.literal("vector"),
    viewBox: z.tuple([
      z.number().min(1).max(256),
      z.number().min(1).max(256),
    ]),
    paths: z
      .array(
        z.object({
          d: z.string().min(1).max(16_384),
          strokeWidth: z.number().gt(0).max(64).nullable(),
          color: threadBackdropColorSchema.nullable(),
        }),
      )
      .max(64),
    color: threadBackdropColorSchema.nullable(),
    ...threadBackdropTilingShape,
  }),
  z.object({
    type: z.literal("image"),
    mime: z.enum(["image/jpeg", "image/png"]),
    dataBase64: z
      .string()
      .min(1)
      .max(THREAD_BACKDROP_IMAGE_MAX_BASE64_CHARS)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    width: z.number().int().min(1).max(4096),
    height: z.number().int().min(1).max(4096),
    ...threadBackdropTilingShape,
  }),
]);
export type ThreadBackdropGround = z.infer<typeof threadBackdropGroundSchema>;

export const threadBackdropSchema = z.object({
  source: z.string().min(1).max(256),
  scene: z.string().min(1).max(256).nullable(),
  colorScheme: threadBackdropColorSchemeSchema.nullable(),
  glass: threadBackdropGlassSchema.nullable(),
  tree: threadBackdropTreeSchema.nullable(),
  ground: threadBackdropGroundSchema.nullable(),
});
export type ThreadBackdrop = z.infer<typeof threadBackdropSchema>;

export const threadBackdropStateSchema = z.object({
  backdrop: threadBackdropSchema.nullable(),
});
export type ThreadBackdropState = z.infer<typeof threadBackdropStateSchema>;
