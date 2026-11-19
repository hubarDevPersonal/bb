import { createHash } from "node:crypto";
import { z } from "zod";

const MAX_COLOR_CHARS = 64;
const MAX_TILE_SIDE = 256;
const MIN_STOPS = 2;
const MAX_STOPS = 16;
const MAX_PATHS = 64;
const MAX_PATH_CHARS = 16_384;
const MAX_STROKE_WIDTH = 64;
const MAX_IMAGE_SIDE = 4096;
const MAX_IMAGE_CHUNKS = 64;
const DEFAULT_GRADIENT_ANGLE = 180;
const IMAGE_INSTANCE_PREFIX = "image:";
export const BACKDROP_IMAGE_MAX_BASE64_CHARS = 56 * 1024;
export const BACKDROP_IMAGE_MAX_BYTES =
  (BACKDROP_IMAGE_MAX_BASE64_CHARS / 4) * 3;

type ClaudeBackdropTiling = {
  size: [number, number] | null;
  repeat: boolean;
};

export type ClaudeBackdropGround =
  | { type: "color"; color: string }
  | ({
      type: "gradient";
      stops: { at: number | null; color: string }[];
      angle: number;
      shape: "linear" | "radial";
    } & ClaudeBackdropTiling)
  | ({
      type: "vector";
      viewBox: [number, number];
      paths: { d: string; strokeWidth: number | null; color: string | null }[];
      color: string | null;
    } & ClaudeBackdropTiling)
  | ({
      type: "image";
      mime: "image/jpeg" | "image/png";
      dataBase64: string;
      width: number;
      height: number;
    } & ClaudeBackdropTiling);

export type ClaudeBackdropImage =
  | { kind: "image"; dataBase64: string }
  | { kind: "tooLarge"; bytes: number };

const wireColorSchema = z.string().trim().min(1).max(MAX_COLOR_CHARS);

const wireTiling = {
  size: z.tuple([z.number(), z.number()]).optional().catch(undefined),
  repeat: z.boolean().optional().catch(undefined),
};

const wireGroundSchema = z.union([
  z.object({ color: wireColorSchema }),
  z.object({
    gradient: z.object({
      stops: z.array(
        z.union([
          wireColorSchema,
          z.object({ at: z.number(), color: wireColorSchema }),
        ]),
      ),
      angle: z.number().optional().catch(undefined),
      shape: z.enum(["linear", "radial"]).optional().catch(undefined),
      ...wireTiling,
    }),
  }),
  z.object({
    vector: z.object({
      viewBox: z.union([z.number(), z.tuple([z.number(), z.number()])]),
      paths: z.array(
        z.union([
          z.string(),
          z.object({
            d: z.string(),
            strokeWidth: z.number().optional().catch(undefined),
            color: wireColorSchema.optional().catch(undefined),
          }),
        ]),
      ),
      color: wireColorSchema.optional().catch(undefined),
      ...wireTiling,
    }),
  }),
  z.object({
    image: z.object({
      type: z.enum(["jpeg", "png"]),
      width: z.number(),
      height: z.number(),
      id: z.string().min(1).max(256),
      ...wireTiling,
    }),
  }),
]);

const colorSchema = z.string().min(1).max(MAX_COLOR_CHARS);

const tilingSchema = {
  size: z
    .tuple([
      z.number().min(1).max(MAX_TILE_SIDE),
      z.number().min(1).max(MAX_TILE_SIDE),
    ])
    .nullable(),
  repeat: z.boolean(),
};

const groundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), color: colorSchema }),
  z.object({
    type: z.literal("gradient"),
    stops: z
      .array(
        z.object({
          at: z.number().min(0).max(1).nullable(),
          color: colorSchema,
        }),
      )
      .min(MIN_STOPS)
      .max(MAX_STOPS),
    angle: z.number().min(-360).max(360),
    shape: z.enum(["linear", "radial"]),
    ...tilingSchema,
  }),
  z.object({
    type: z.literal("vector"),
    viewBox: z.tuple([
      z.number().min(1).max(MAX_TILE_SIDE),
      z.number().min(1).max(MAX_TILE_SIDE),
    ]),
    paths: z
      .array(
        z.object({
          d: z.string().min(1).max(MAX_PATH_CHARS),
          strokeWidth: z.number().gt(0).max(MAX_STROKE_WIDTH).nullable(),
          color: colorSchema.nullable(),
        }),
      )
      .max(MAX_PATHS),
    color: colorSchema.nullable(),
    ...tilingSchema,
  }),
  z.object({
    type: z.literal("image"),
    mime: z.enum(["image/jpeg", "image/png"]),
    dataBase64: z
      .string()
      .min(1)
      .max(BACKDROP_IMAGE_MAX_BASE64_CHARS)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    width: z.number().int().min(1).max(MAX_IMAGE_SIDE),
    height: z.number().int().min(1).max(MAX_IMAGE_SIDE),
    ...tilingSchema,
  }),
]);

export const backdropGroundSchema: z.ZodType<ClaudeBackdropGround> =
  groundSchema;

type WireTiling = {
  size?: [number, number] | undefined;
  repeat?: boolean | undefined;
};

function toTiling(wire: WireTiling): ClaudeBackdropTiling {
  return {
    size: wire.size ?? null,
    repeat: wire.repeat ?? false,
  };
}

function toWireGround(value: unknown): z.infer<typeof wireGroundSchema> | null {
  const parsed = wireGroundSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function readBackdropImageId(ground: unknown): string | null {
  const wire = toWireGround(ground);
  return wire !== null && "image" in wire ? wire.image.id : null;
}

function buildGround(
  wire: z.infer<typeof wireGroundSchema>,
  image: ClaudeBackdropImage | null,
): ClaudeBackdropGround | null {
  if ("color" in wire) {
    return { type: "color", color: wire.color };
  }
  if ("gradient" in wire) {
    return {
      type: "gradient",
      stops: wire.gradient.stops.map((stop) =>
        typeof stop === "string"
          ? { at: null, color: stop }
          : { at: stop.at, color: stop.color },
      ),
      angle: wire.gradient.angle ?? DEFAULT_GRADIENT_ANGLE,
      shape: wire.gradient.shape ?? "linear",
      ...toTiling(wire.gradient),
    };
  }
  if ("vector" in wire) {
    const { viewBox } = wire.vector;
    return {
      type: "vector",
      viewBox: typeof viewBox === "number" ? [viewBox, viewBox] : viewBox,
      paths: wire.vector.paths.map((path) =>
        typeof path === "string"
          ? { d: path, strokeWidth: null, color: null }
          : {
              d: path.d,
              strokeWidth: path.strokeWidth ?? null,
              color: path.color ?? null,
            },
      ),
      color: wire.vector.color ?? null,
      ...toTiling(wire.vector),
    };
  }
  if (image === null || image.kind !== "image") {
    return null;
  }
  return {
    type: "image",
    mime: wire.image.type === "png" ? "image/png" : "image/jpeg",
    dataBase64: image.dataBase64,
    width: wire.image.width,
    height: wire.image.height,
    ...toTiling(wire.image),
  };
}

export function toBackdropGround(
  value: unknown,
  image: ClaudeBackdropImage | null,
): ClaudeBackdropGround | null {
  const wire = toWireGround(value);
  if (wire === null) {
    return null;
  }
  const ground = buildGround(wire, image);
  return ground !== null && groundSchema.safeParse(ground).success
    ? ground
    : null;
}

const IMAGE_CHUNK_BYTES = 40_960;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const imageChunkSchema = z.object({
  props: z.object({
    data: z.string().regex(BASE64_PATTERN),
    index: z.number().int().min(0),
    of: z.number().int().min(1).max(MAX_IMAGE_CHUNKS),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    bytes: z.number().int().min(1),
  }),
});

type ImageChunk = z.infer<typeof imageChunkSchema>["props"];

export function backdropImageChunkInstanceId(
  id: string,
  index: number,
): string {
  return `${IMAGE_INSTANCE_PREFIX}${id}:${index}`;
}

function readImageChunk(reply: unknown, index: number): ImageChunk {
  const parsed = imageChunkSchema.safeParse(reply);
  if (!parsed.success || parsed.data.props.index !== index) {
    throw new Error(`backdrop image chunk ${index} is malformed`);
  }
  return parsed.data.props;
}

function decodeImageChunk(chunk: ImageChunk): Buffer {
  const bytes = Buffer.from(chunk.data, "base64");
  const isLast = chunk.index === chunk.of - 1;
  const expected = isLast
    ? chunk.bytes - IMAGE_CHUNK_BYTES * (chunk.of - 1)
    : IMAGE_CHUNK_BYTES;
  if (bytes.length !== expected) {
    throw new Error(
      `backdrop image chunk ${chunk.index} is ${bytes.length} bytes, not ${expected}`,
    );
  }
  return bytes;
}

export async function fetchBackdropImage(
  id: string,
  renderChunk: (instanceId: string) => Promise<unknown>,
): Promise<ClaudeBackdropImage> {
  const first = readImageChunk(
    await renderChunk(backdropImageChunkInstanceId(id, 0)),
    0,
  );
  if (first.bytes > BACKDROP_IMAGE_MAX_BYTES) {
    return { kind: "tooLarge", bytes: first.bytes };
  }
  if (first.of !== Math.ceil(first.bytes / IMAGE_CHUNK_BYTES)) {
    throw new Error(
      `backdrop image of ${first.bytes} bytes cannot come in ${first.of} chunks`,
    );
  }
  const parts = [decodeImageChunk(first)];
  for (let index = 1; index < first.of; index += 1) {
    const chunk = readImageChunk(
      await renderChunk(backdropImageChunkInstanceId(id, index)),
      index,
    );
    if (
      chunk.of !== first.of ||
      chunk.bytes !== first.bytes ||
      chunk.hash !== first.hash
    ) {
      throw new Error("backdrop image changed while its chunks were read");
    }
    parts.push(decodeImageChunk(chunk));
  }
  const bytes = Buffer.concat(parts);
  if (createHash("sha256").update(bytes).digest("hex") !== first.hash) {
    throw new Error("backdrop image does not match its hash");
  }
  return { kind: "image", dataBase64: bytes.toString("base64") };
}
