import { describe, expect, it } from "vitest";
import {
  THREAD_BACKDROP_MAX_DEPTH,
  THREAD_BACKDROP_MAX_NODES,
  type ThreadBackdropNode,
  threadBackdropStateSchema,
} from "../src/thread-backdrop-state.js";

function nestedBoxes(depth: number): ThreadBackdropNode {
  let node: ThreadBackdropNode = { type: "Box", props: {}, children: ["leaf"] };
  for (let level = 1; level < depth; level += 1) {
    node = { type: "Box", props: {}, children: [node] };
  }
  return node;
}

function stateWithTree(tree: ThreadBackdropNode) {
  return {
    backdrop: {
      source: "night-sky",
      scene: "night-sky",
      colorScheme: "dark",
      glass: null,
      tree,
      ground: null,
    },
  };
}

describe("threadBackdropStateSchema", () => {
  it("accepts a tree at the depth limit", () => {
    const result = threadBackdropStateSchema.safeParse(
      stateWithTree(nestedBoxes(THREAD_BACKDROP_MAX_DEPTH)),
    );
    expect(result.success).toBe(true);
  });

  it("rejects a tree past the depth limit without overflowing the stack", () => {
    const deep = threadBackdropStateSchema.safeParse(
      stateWithTree(nestedBoxes(THREAD_BACKDROP_MAX_DEPTH + 1)),
    );
    expect(deep.success).toBe(false);

    let parse: ReturnType<typeof threadBackdropStateSchema.safeParse> | null =
      null;
    expect(() => {
      parse = threadBackdropStateSchema.safeParse(
        stateWithTree(nestedBoxes(20_000)),
      );
    }).not.toThrow();
    expect(parse).toMatchObject({ success: false });
  });

  it("rejects a tree with more nodes than the limit", () => {
    const wide: ThreadBackdropNode = {
      type: "Box",
      props: {},
      children: Array.from({ length: 256 }, () => ({
        type: "Box" as const,
        props: {},
        children: Array.from({ length: 8 }, () => ({
          type: "Text" as const,
          props: {},
          children: [],
        })),
      })),
    };
    expect(1 + 256 + 256 * 8).toBeGreaterThan(THREAD_BACKDROP_MAX_NODES);
    expect(threadBackdropStateSchema.safeParse(stateWithTree(wide)).success).toBe(
      false,
    );
  });
});
