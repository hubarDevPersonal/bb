import { describe, expect, it } from "vitest";
import {
  BACKDROP_MAX_PAYLOAD_BYTES,
  UnsupportedUiControlError,
  createBackdropPublisher,
  invalidatesBackdrop,
  isUnsupportedUiControlError,
  toBackdropState,
  type ClaudeBackdropState,
} from "./backdrop.js";

const convertScene = (scene: unknown) =>
  toBackdropState({ scene, theme: null, image: null });

const nightSkySvg = `<svg xmlns="http://www.w3.org/2000/svg">${"<circle r='1'/>".repeat(40)}</svg>`;

describe("toBackdropState", () => {
  it("converts a rendered night-sky backdrop", () => {
    expect(
      convertScene({
        tree: {
          type: "Box",
          props: { backgroundColor: "blue" },
          children: [{ type: "Text", children: ["Night sky"] }],
        },
        props: {
          id: "night-sky",
          plugin: "night-sky",
          glass: false,
          colorScheme: "dark",
        },
        rewritten: false,
        hooked: true,
      }),
    ).toEqual({
      state: {
        backdrop: {
          source: "night-sky",
          scene: "night-sky",
          colorScheme: "dark",
          glass: null,
          ground: null,
          tree: {
            type: "Box",
            props: { backgroundColor: "blue" },
            children: [{ type: "Text", props: {}, children: ["Night sky"] }],
          },
        },
      },
      treeDropped: false,
      groundDropped: false,
    });
  });

  it("reads Svg attributes from props and ignores part, hover and group marks", () => {
    expect(
      convertScene({
        tree: {
          type: "Box",
          props: { backgroundColor: "#0b1026" },
          children: [
            {
              type: "Svg",
              props: { source: nightSkySvg, alt: "Night sky", width: 640 },
            },
          ],
          part: { plugin: "night-sky" },
          hover: { borderColor: "red" },
          group: { plugin: "night-sky" },
        },
        props: {
          id: "night-sky",
          plugin: "night-sky",
          glass: { blur: 12, opacity: 0.55 },
          colorScheme: "dark",
        },
        rewritten: false,
        hooked: true,
        drawn_by: ["night-sky"],
      }).state,
    ).toEqual({
      backdrop: {
        source: "night-sky",
        scene: "night-sky",
        colorScheme: "dark",
        glass: { blur: 12, opacity: 0.55, tint: null },
        ground: null,
        tree: {
          type: "Box",
          props: { backgroundColor: "#0b1026" },
          children: [
            {
              type: "Svg",
              source: nightSkySvg,
              alt: "Night sky",
              width: 640,
              height: null,
            },
          ],
        },
      },
    });
  });

  it("publishes no backdrop when the engine draws the default", () => {
    expect(
      convertScene({
        tree: { type: "engine", ref: 0 },
        props: {},
        rewritten: false,
        hooked: true,
        drawn_by: [],
      }),
    ).toEqual({
      state: { backdrop: null },
      treeDropped: false,
      groundDropped: false,
    });
  });

  it("prefers scene over id, reads overrideColorScheme and fills glass defaults", () => {
    expect(
      convertScene({
        tree: { type: "engine", ref: 0 },
        props: {
          scene: "lagoon",
          id: "legacy",
          plugin: "waves",
          glass: { tint: "#123456" },
          colorScheme: "sepia",
          overrideColorScheme: "light",
        },
      }).state,
    ).toEqual({
      backdrop: {
        source: "waves",
        scene: "lagoon",
        colorScheme: "light",
        glass: { blur: 16, opacity: 0.6, tint: "#123456" },
        ground: null,
        tree: null,
      },
    });
  });

  it("drops oversized Svg sources and unknown node types", () => {
    expect(
      convertScene({
        tree: {
          type: "Box",
          props: { flexGrow: 1, style: { nested: true } },
          children: [
            { type: "Svg", props: { source: "x".repeat(61 * 1024), alt: "" } },
            { type: "Button", props: { key: "go", label: "Go" } },
            { type: "Link", props: { href: "https://example.com" } },
            { type: "engine", ref: 0 },
            "kept",
          ],
        },
        props: { id: "stars", plugin: "stars", glass: false },
      }).state.backdrop?.tree,
    ).toEqual({ type: "Box", props: { flexGrow: 1 }, children: ["kept"] });
  });

  it("keeps the backdrop without a drawing when the tree converts to nothing", () => {
    expect(
      convertScene({
        tree: { type: "Markdown", props: { source: "# hi" } },
        props: { id: "stars", plugin: "stars", glass: false },
      }),
    ).toEqual({
      state: {
        backdrop: {
          source: "stars",
          scene: "stars",
          colorScheme: null,
          glass: null,
          ground: null,
          tree: null,
        },
      },
      treeDropped: false,
      groundDropped: false,
    });
  });

  it("cuts nodes nested deeper than the depth limit", () => {
    let tree: unknown = { type: "Text", children: ["deep"] };
    for (let level = 0; level < 40; level += 1) {
      tree = { type: "Box", children: [tree] };
    }
    const converted = convertScene({
      tree,
      props: { id: "deep", plugin: "deep", glass: false },
    }).state.backdrop?.tree;
    let depth = 0;
    let node: unknown = converted;
    while (
      typeof node === "object" &&
      node !== null &&
      "children" in node &&
      Array.isArray(node.children)
    ) {
      depth += 1;
      node = node.children[0];
    }
    expect(depth).toBe(32);
  });

  it("drops the drawing when the state would exceed the payload limit", () => {
    const svg = {
      type: "Svg",
      props: { source: "y".repeat(50 * 1024), alt: "" },
    };
    const conversion = convertScene({
      tree: { type: "Box", children: [svg, svg] },
      props: { id: "big", plugin: "big", glass: false, colorScheme: "dark" },
    });
    expect(conversion).toEqual({
      state: {
        backdrop: {
          source: "big",
          scene: "big",
          colorScheme: "dark",
          glass: null,
          ground: null,
          tree: null,
        },
      },
      treeDropped: true,
      groundDropped: false,
    });
    expect(
      Buffer.byteLength(JSON.stringify(conversion.state)),
    ).toBeLessThanOrEqual(BACKDROP_MAX_PAYLOAD_BYTES);
  });
});

describe("invalidatesBackdrop", () => {
  const base = {
    type: "system",
    subtype: "ui_invalidate",
    event: "ui.render",
    uuid: "u",
    session_id: "s",
  };

  it("treats an invalidation without instances as touching the backdrop", () => {
    expect(invalidatesBackdrop(base)).toBe(true);
  });

  it("re-renders for the desktop Backdrop or Theme instances", () => {
    expect(
      invalidatesBackdrop({
        ...base,
        prompts_screened: true,
        instances: [
          {
            surface: "desktop",
            component: "Backdrop",
            instance_id: "backdrop",
          },
          { surface: "desktop", component: "Theme", instance_id: "theme" },
          { surface: "mobile", component: "Backdrop", instance_id: "backdrop" },
        ],
      }),
    ).toBe(true);
    expect(
      invalidatesBackdrop({
        ...base,
        instances: [
          { surface: "desktop", component: "Theme", instance_id: "theme" },
        ],
      }),
    ).toBe(true);
  });

  it("ignores invalidations of other instances and other messages", () => {
    expect(
      invalidatesBackdrop({
        ...base,
        instances: [
          { surface: "mobile", component: "Backdrop", instance_id: "backdrop" },
          { surface: "desktop", component: "Pane", instance_id: "p1" },
        ],
      }),
    ).toBe(false);
    expect(invalidatesBackdrop({ ...base, subtype: "ui_toast" })).toBe(false);
    expect(invalidatesBackdrop({ type: "assistant" })).toBe(false);
  });
});

describe("toBackdropState on very deep input", () => {
  it("cuts the drawing at the depth limit without walking the rest", () => {
    let tree: unknown = { type: "Text", children: ["deep"] };
    for (let level = 0; level < 100_000; level += 1) {
      tree = { type: "Box", children: [tree] };
    }
    const conversion = convertScene({
      tree,
      props: { id: "deep", plugin: "deep", glass: false },
    });
    let depth = 0;
    let node: unknown = conversion.state.backdrop?.tree;
    while (typeof node === "object" && node !== null) {
      depth += 1;
      const children: unknown = Reflect.get(node, "children");
      node = Array.isArray(children) ? children[0] : undefined;
    }
    expect(conversion.treeDropped).toBe(false);
    expect(depth).toBe(32);
  });
});

describe("isUnsupportedUiControlError", () => {
  it("recognises refusals from CLIs that cannot draw backdrops", () => {
    expect(
      isUnsupportedUiControlError(
        new Error("ui_render: component a render site name"),
      ),
    ).toBe(true);
    expect(
      isUnsupportedUiControlError(
        new Error("Unsupported control request subtype: ui_attach"),
      ),
    ).toBe(true);
    expect(
      isUnsupportedUiControlError(new UnsupportedUiControlError("x")),
    ).toBe(true);
    expect(
      isUnsupportedUiControlError(
        new Error("The operation was aborted due to timeout"),
      ),
    ).toBe(false);
  });
});

describe("createBackdropPublisher", () => {
  function createHarness() {
    let now = 0;
    let timers: { at: number; callback: () => void; cancelled: boolean }[] = [];
    const sent: ClaudeBackdropState[] = [];
    const publisher = createBackdropPublisher({
      scheduler: {
        now: () => now,
        schedule(callback, delayMs) {
          const timer = { at: now + delayMs, callback, cancelled: false };
          timers.push(timer);
          return () => {
            timer.cancelled = true;
          };
        },
      },
      send: (state) => sent.push(state),
    });
    return {
      publisher,
      sent,
      advance(ms: number) {
        now += ms;
        const due = timers.filter(
          (timer) => !timer.cancelled && timer.at <= now,
        );
        timers = timers.filter((timer) => !due.includes(timer));
        for (const timer of due) {
          timer.callback();
        }
      },
    };
  }
  const scene = (name: string): ClaudeBackdropState => ({
    backdrop: {
      source: "p",
      scene: name,
      colorScheme: null,
      glass: null,
      ground: null,
      tree: null,
    },
  });

  it("always publishes the first outcome, even an empty backdrop, then dedupes", () => {
    const { publisher, sent, advance } = createHarness();
    publisher.offer({ backdrop: null });
    advance(5000);
    publisher.offer({ backdrop: null });
    expect(sent).toEqual([{ backdrop: null }]);
  });

  it("throttles to one publish per second with a trailing publish of the latest", () => {
    const { publisher, sent, advance } = createHarness();
    publisher.offer(scene("a"));
    advance(100);
    publisher.offer(scene("b"));
    publisher.offer(scene("c"));
    expect(sent).toEqual([scene("a")]);
    advance(899);
    expect(sent).toEqual([scene("a")]);
    advance(1);
    expect(sent).toEqual([scene("a"), scene("c")]);
    advance(400);
    publisher.offer(scene("c"));
    advance(5000);
    expect(sent).toEqual([scene("a"), scene("c")]);
  });

  it("skips a trailing publish that returned to the published state, and drops pending work on close", () => {
    const { publisher, sent, advance } = createHarness();
    publisher.offer(scene("a"));
    publisher.offer(scene("b"));
    publisher.offer(scene("a"));
    advance(1000);
    expect(sent).toEqual([scene("a")]);
    publisher.offer(scene("d"));
    advance(10);
    publisher.offer(scene("e"));
    publisher.close();
    advance(5000);
    publisher.offer(scene("f"));
    expect(sent).toEqual([scene("a"), scene("d")]);
  });
});
