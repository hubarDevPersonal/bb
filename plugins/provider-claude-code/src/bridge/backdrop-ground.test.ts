import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toBackdropState } from "./backdrop.js";
import {
  BACKDROP_IMAGE_MAX_BYTES,
  fetchBackdropImage,
  toBackdropGround,
} from "./backdrop-ground.js";

const engine = { type: "engine", ref: 0 };
const emptyReply = { tree: engine, props: {}, rewritten: false, hooked: true };

function themeReply(props: Record<string, unknown>) {
  return { tree: engine, props, rewritten: false, hooked: true, drawn_by: [] };
}

describe("toBackdropState with Claude Code 2.1.325 replies", () => {
  it("reads a scene drawn under Theme/backdrop with its overrideColorScheme", () => {
    expect(
      toBackdropState({
        scene: {
          tree: { type: "Box", props: { backgroundColor: "#0b1026" } },
          props: {
            scene: "night-sky",
            plugin: "night-sky",
            glass: { blur: 12, opacity: 0.55 },
            overrideColorScheme: "dark",
          },
          rewritten: false,
          hooked: true,
        },
        theme: emptyReply,
        image: null,
      }).state,
    ).toEqual({
      backdrop: {
        source: "night-sky",
        scene: "night-sky",
        colorScheme: "dark",
        glass: { blur: 12, opacity: 0.55, tint: null },
        tree: {
          type: "Box",
          props: { backgroundColor: "#0b1026" },
          children: [],
        },
        ground: null,
      },
    });
  });

  it("reads a still gradient ground from Theme/theme", () => {
    expect(
      toBackdropState({
        scene: emptyReply,
        theme: themeReply({
          plugin: "ground-probe",
          overrideColorScheme: "dark",
          backdrop: { gradient: { stops: ["#0b1026", "#3b3f7a"] } },
        }),
        image: null,
      }).state,
    ).toEqual({
      backdrop: {
        source: "ground-probe",
        scene: null,
        colorScheme: "dark",
        glass: null,
        tree: null,
        ground: {
          type: "gradient",
          stops: [
            { at: null, color: "#0b1026" },
            { at: null, color: "#3b3f7a" },
          ],
          angle: 180,
          shape: "linear",
          size: null,
          repeat: false,
        },
      },
    });
  });

  it("forces only the color scheme when a plugin names one without a ground", () => {
    expect(
      toBackdropState({
        scene: emptyReply,
        theme: themeReply({ plugin: "mode", overrideColorScheme: "light" }),
        image: null,
      }).state,
    ).toEqual({
      backdrop: {
        source: "mode",
        scene: null,
        colorScheme: "light",
        glass: null,
        tree: null,
        ground: null,
      },
    });
  });

  it("publishes no backdrop when neither reply carries one", () => {
    expect(
      toBackdropState({
        scene: emptyReply,
        theme: themeReply({ plugin: "palette", colors: { v: 1 } }),
        image: null,
      }).state,
    ).toEqual({ backdrop: null });
  });

  it("drops a ground that does not fit the state limit", () => {
    const conversion = toBackdropState({
      scene: emptyReply,
      theme: themeReply({
        plugin: "big",
        overrideColorScheme: "dark",
        backdrop: {
          vector: {
            viewBox: 10,
            paths: Array.from(
              { length: 64 },
              () => `M0 0${" L1 1".repeat(250)}`,
            ),
          },
        },
      }),
      image: null,
    });
    expect(conversion.groundDropped).toBe(true);
    expect(conversion.state.backdrop?.ground).toBeNull();
    expect(conversion.state.backdrop?.colorScheme).toBe("dark");
  });
});

describe("toBackdropGround", () => {
  it("converts a color ground", () => {
    expect(toBackdropGround({ color: "surface-0" }, null)).toEqual({
      type: "color",
      color: "surface-0",
    });
  });

  it("converts a gradient with placed stops and tiling", () => {
    expect(
      toBackdropGround(
        {
          gradient: {
            stops: ["#000", { at: 0.7, color: "#fff" }],
            angle: 135,
            shape: "radial",
            size: [24, 8],
            repeat: true,
          },
        },
        null,
      ),
    ).toEqual({
      type: "gradient",
      stops: [
        { at: null, color: "#000" },
        { at: 0.7, color: "#fff" },
      ],
      angle: 135,
      shape: "radial",
      size: [24, 8],
      repeat: true,
    });
  });

  it("converts a vector with a square viewBox and mixed paths", () => {
    expect(
      toBackdropGround(
        {
          vector: {
            viewBox: 24,
            paths: [
              "M0 0H12V12H0Z",
              { d: "M12 12H24V24H12Z", strokeWidth: 2, color: "#ff8800" },
            ],
            color: "#223344",
            size: [24, 24],
            repeat: true,
          },
        },
        null,
      ),
    ).toEqual({
      type: "vector",
      viewBox: [24, 24],
      paths: [
        { d: "M0 0H12V12H0Z", strokeWidth: null, color: null },
        { d: "M12 12H24V24H12Z", strokeWidth: 2, color: "#ff8800" },
      ],
      color: "#223344",
      size: [24, 24],
      repeat: true,
    });
  });

  it("converts an image only once its bytes were read", () => {
    const wire = {
      image: {
        type: "png",
        width: 16,
        height: 16,
        id: "abc",
        size: [32, 32],
        repeat: true,
      },
    };
    expect(toBackdropGround(wire, null)).toBeNull();
    expect(
      toBackdropGround(wire, { kind: "tooLarge", bytes: 99_999 }),
    ).toBeNull();
    expect(
      toBackdropGround(wire, { kind: "image", dataBase64: "iVBORw==" }),
    ).toEqual({
      type: "image",
      mime: "image/png",
      dataBase64: "iVBORw==",
      width: 16,
      height: 16,
      size: [32, 32],
      repeat: true,
    });
  });

  it("refuses grounds outside bb's limits", () => {
    expect(
      toBackdropGround({ gradient: { stops: ["#000"] } }, null),
    ).toBeNull();
    expect(
      toBackdropGround({ vector: { viewBox: 512, paths: ["M0 0"] } }, null),
    ).toBeNull();
    expect(toBackdropGround({ scene: "x" }, null)).toBeNull();
  });
});

describe("fetchBackdropImage", () => {
  const CHUNK = 40_960;
  const sha256 = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");

  type Chunk = {
    data: string;
    index: number;
    of: number;
    hash: string;
    bytes: number;
  };

  function chunksOf(bytes: Buffer): Chunk[] {
    const of = Math.ceil(bytes.length / CHUNK);
    return Array.from({ length: of }, (_, index) => ({
      data: bytes
        .subarray(index * CHUNK, (index + 1) * CHUNK)
        .toString("base64"),
      index,
      of,
      hash: sha256(bytes),
      bytes: bytes.length,
    }));
  }

  function serve(chunks: Chunk[], asked: string[] = []) {
    return (instanceId: string) => {
      asked.push(instanceId);
      const index = Number(instanceId.split(":").at(-1));
      return Promise.resolve(themeReply(chunks[index] ?? {}));
    };
  }

  const twoChunkBytes = Buffer.from(
    Array.from({ length: 41_000 }, (_, index) => index % 251),
  );

  it("assembles an image from its chunks and encodes it once", async () => {
    const asked: string[] = [];
    const image = await fetchBackdropImage(
      "abc",
      serve(chunksOf(twoChunkBytes), asked),
    );
    expect(asked).toEqual(["image:abc:0", "image:abc:1"]);
    expect(image).toEqual({
      kind: "image",
      dataBase64: twoChunkBytes.toString("base64"),
    });
  });

  it("stops after the first chunk when the image is over the limit", async () => {
    const bytes = Buffer.alloc(BACKDROP_IMAGE_MAX_BYTES + 1, 7);
    const asked: string[] = [];
    expect(
      await fetchBackdropImage("big", serve(chunksOf(bytes), asked)),
    ).toEqual({ kind: "tooLarge", bytes: BACKDROP_IMAGE_MAX_BYTES + 1 });
    expect(asked).toEqual(["image:big:0"]);
  });

  it.each([
    [
      "a chunk count that does not fit the size",
      (chunks: Chunk[]) => chunks.map((chunk) => ({ ...chunk, of: 3 })),
      "cannot come in 3 chunks",
    ],
    [
      "a chunk answering for another index",
      (chunks: Chunk[]) => [chunks[0], { ...chunks[1], index: 0 }],
      "chunk 1 is malformed",
    ],
    [
      "data that is not base64",
      (chunks: Chunk[]) => [{ ...chunks[0], data: "not base64!" }, chunks[1]],
      "chunk 0 is malformed",
    ],
    [
      "a hash that is not sha256 hex",
      (chunks: Chunk[]) => chunks.map((chunk) => ({ ...chunk, hash: "h" })),
      "chunk 0 is malformed",
    ],
    [
      "a later chunk from another file",
      (chunks: Chunk[]) => [chunks[0], { ...chunks[1], hash: "0".repeat(64) }],
      "changed while its chunks were read",
    ],
    [
      "a short non-last chunk",
      (chunks: Chunk[]) => [
        {
          ...chunks[0],
          data: twoChunkBytes.subarray(0, 30).toString("base64"),
        },
        chunks[1],
      ],
      "chunk 0 is 30 bytes, not 40960",
    ],
    [
      "a last chunk shorter than the remainder",
      (chunks: Chunk[]) => [
        chunks[0],
        { ...chunks[1], data: twoChunkBytes.subarray(0, 3).toString("base64") },
      ],
      "chunk 1 is 3 bytes, not 40",
    ],
    [
      "bytes that do not match the hash",
      (chunks: Chunk[]) => [
        chunks[0],
        {
          ...chunks[1],
          data: Buffer.alloc(40, 1).toString("base64"),
        },
      ],
      "does not match its hash",
    ],
  ])("rejects %s", async (_label, tamper, message) => {
    await expect(
      fetchBackdropImage("bad", serve(tamper(chunksOf(twoChunkBytes)))),
    ).rejects.toThrow(message);
  });
});
