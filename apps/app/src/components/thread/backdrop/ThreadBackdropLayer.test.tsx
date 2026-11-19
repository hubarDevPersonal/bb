// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ThreadBackdrop,
  ThreadBackdropGround,
  ThreadBackdropNode,
} from "@bb/domain";
import { PageShell } from "@/components/ui/page-shell";
import {
  ThreadBackdropLayer,
  hasThreadBackdropLayer,
  threadBackdropColorSchemeClassName,
} from "./ThreadBackdropLayer";
import {
  resolveThreadBackdropColor,
  threadBackdropBoxStyle,
} from "./thread-backdrop-style";

const themeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../ui/theme.css"),
  "utf8",
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function backdropWith(overrides: Partial<ThreadBackdrop>): ThreadBackdrop {
  return {
    source: "night-sky",
    scene: "night-sky",
    colorScheme: null,
    glass: null,
    tree: null,
    ground: null,
    ...overrides,
  };
}

function renderLayer(backdrop: ThreadBackdrop): HTMLElement {
  const { container } = render(<ThreadBackdropLayer backdrop={backdrop} />);
  const layer = container.querySelector<HTMLElement>("[data-thread-backdrop]");
  if (layer === null) throw new Error("backdrop layer missing");
  return layer;
}

function nodeOf(layer: HTMLElement, type: string): HTMLElement {
  const node = layer.querySelector<HTMLElement>(
    `[data-thread-backdrop-node="${type}"]`,
  );
  if (node === null) throw new Error(`${type} node missing`);
  return node;
}

describe("ThreadBackdropLayer", () => {
  it("paints the night-sky box blue across the whole layer behind the content", () => {
    const layer = renderLayer(
      backdropWith({
        tree: {
          type: "Box",
          props: { backgroundColor: "blue" },
          children: [{ type: "Text", props: {}, children: ["Night sky"] }],
        },
      }),
    );

    const box = nodeOf(layer, "Box");
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.className).toContain("pointer-events-none");
    expect(layer.className).toContain("absolute");
    expect(layer.className).toContain("inset-0");
    expect(layer.className).toContain("-z-10");
    expect(box.style.backgroundColor).toBe("blue");
    expect(box.style.width).toBe("100%");
    expect(box.style.height).toBe("100%");
    expect(box.style.display).toBe("flex");
    expect(screen.getByText("Night sky").tagName).toBe("SPAN");
  });

  it("drops colors that could smuggle extra declarations or urls", () => {
    const layer = renderLayer(
      backdropWith({
        tree: {
          type: "Box",
          props: {
            backgroundColor: "url(javascript:alert(1))",
            borderStyle: "single",
            borderColor: "expression(alert(1))",
            width: "calc(100%);position:fixed",
          },
          children: [
            {
              type: "Text",
              props: { color: "red;position:fixed", backgroundColor: "#00f" },
              children: ["Unsafe"],
            },
          ],
        },
      }),
    );

    const box = nodeOf(layer, "Box");
    const text = nodeOf(layer, "Text");
    const markup = layer.outerHTML;
    expect(box.style.backgroundColor).toBe("");
    expect(box.style.borderColor).toBe("var(--border)");
    expect(box.style.width).toBe("100%");
    expect(text.style.color).toBe("");
    expect(text.style.backgroundColor).not.toBe("");
    expect(markup).not.toContain("javascript");
    expect(markup).not.toContain("url(");
    expect(markup).not.toContain("expression");
    expect(markup).not.toContain("fixed");
  });

  it("renders Svg markup only as an image data URI, never as inline svg", () => {
    const source =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>';
    const layer = renderLayer(
      backdropWith({
        tree: { type: "Svg", source, alt: "Stars", width: null, height: null },
      }),
    );

    const image = screen.getByAltText("Stars");
    expect(image.tagName).toBe("IMG");
    expect(image.getAttribute("src")).toBe(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,
    );
    expect(image.style.objectFit).toBe("cover");
    expect(image.style.width).toBe("100%");
    expect(layer.querySelector("svg")).toBeNull();
    expect(layer.querySelector("script")).toBeNull();
  });

  it("sizes an Svg among siblings to its declared size", () => {
    const layer = renderLayer(
      backdropWith({
        tree: {
          type: "Box",
          props: {},
          children: [
            "Moon",
            {
              type: "Svg",
              source: "<svg/>",
              alt: "Moon",
              width: 48,
              height: 24,
            },
          ],
        },
      }),
    );

    const image = nodeOf(layer, "Svg");
    expect(image.style.width).toBe("48px");
    expect(image.style.height).toBe("24px");
    expect(image.style.objectFit).toBe("");
  });

  it("adds a frosted glass layer above the tree", () => {
    const layer = renderLayer(
      backdropWith({
        glass: { blur: 12, opacity: 0.4, tint: null },
        tree: { type: "Box", props: {}, children: [] },
      }),
    );

    const glass = layer.querySelector<HTMLElement>(
      "[data-thread-backdrop-glass]",
    );
    expect(glass).not.toBeNull();
    expect(glass?.className).toContain(
      "backdrop-blur-(--thread-backdrop-glass-blur)",
    );
    expect(glass?.style.getPropertyValue("--thread-backdrop-glass-blur")).toBe(
      "12px",
    );
    expect(glass?.style.getPropertyValue("--thread-backdrop-glass-fill")).toBe(
      "color-mix(in oklab, var(--canvas) 40%, transparent)",
    );
    expect(layer.lastElementChild).toBe(glass);
  });

  it("tints the glass only with a valid color", () => {
    const tinted = renderLayer(
      backdropWith({ glass: { blur: 4, opacity: 0.5, tint: "#123456" } }),
    );
    expect(
      tinted
        .querySelector<HTMLElement>("[data-thread-backdrop-glass]")
        ?.style.getPropertyValue("--thread-backdrop-glass-fill"),
    ).toBe("color-mix(in oklab, #123456 50%, transparent)");
    cleanup();

    const unsafe = renderLayer(
      backdropWith({
        glass: { blur: 4, opacity: 0.5, tint: "red;background:url(x)" },
      }),
    );
    expect(
      unsafe
        .querySelector<HTMLElement>("[data-thread-backdrop-glass]")
        ?.style.getPropertyValue("--thread-backdrop-glass-fill"),
    ).toBe("color-mix(in oklab, var(--canvas) 50%, transparent)");
  });

  it("stops rendering past the maximum nesting depth", () => {
    let tree: ThreadBackdropNode = {
      type: "Box",
      props: {},
      children: ["leaf"],
    };
    for (let index = 0; index < 64; index += 1) {
      tree = { type: "Box", props: {}, children: [tree] };
    }

    const layer = renderLayer(backdropWith({ tree }));

    expect(
      layer.querySelectorAll('[data-thread-backdrop-node="Box"]').length,
    ).toBe(32);
    expect(layer.textContent).not.toContain("leaf");
  });
});

function groundOf(ground: ThreadBackdropGround): Element | null {
  const layer = renderLayer(backdropWith({ scene: null, ground }));
  return layer.querySelector("[data-thread-backdrop-ground]");
}

function groundStyleOf(ground: ThreadBackdropGround): CSSStyleDeclaration {
  const element = groundOf(ground);
  if (!(element instanceof HTMLElement)) throw new Error("ground missing");
  return element.style;
}

describe("still grounds", () => {
  it("covers the layer with a color ground", () => {
    const element = groundOf({ type: "color", color: "surface-0" });
    expect(element?.className).toContain("inset-0");
    expect(
      groundStyleOf({ type: "color", color: "#102030" }).backgroundColor,
    ).toBe("rgb(16, 32, 48)");
    expect(
      groundStyleOf({ type: "color", color: "fill-danger" }).backgroundColor,
    ).toBe("var(--destructive)");
  });

  it("draws nothing for an unsafe color ground", () => {
    expect(groundOf({ type: "color", color: "url(x)" })).toBeNull();
    expect(groundOf({ type: "color", color: "var(--canvas)" })).toBeNull();
  });

  it("stretches a linear gradient with angle and stop positions", () => {
    const style = groundStyleOf({
      type: "gradient",
      stops: [
        { at: 0, color: "#000000" },
        { at: 0.25, color: "red" },
        { at: null, color: "text-primary" },
      ],
      angle: 45,
      shape: "linear",
      size: [20, 10],
      repeat: false,
    });
    expect(style.backgroundImage).toContain("linear-gradient(45deg");
    expect(style.backgroundImage).toContain("red 25%");
    expect(style.backgroundImage).toContain("var(--foreground) 100%");
    expect(style.backgroundSize).toBe("100% 100%");
    expect(style.backgroundRepeat).toBe("no-repeat");
  });

  it("tiles a radial gradient at its size", () => {
    const style = groundStyleOf({
      type: "gradient",
      stops: [
        { at: null, color: "blue" },
        { at: 1, color: "transparent" },
      ],
      angle: 0,
      shape: "radial",
      size: [24, 12],
      repeat: true,
    });
    expect(style.backgroundImage).toContain(
      "radial-gradient(closest-side, blue 0%, transparent 100%)",
    );
    expect(style.backgroundImage).not.toContain("deg");
    expect(style.backgroundSize).toBe("24px 12px");
    expect(style.backgroundRepeat).toBe("repeat");
  });

  function linearGradient(
    stops: { at: number | null; color: string }[],
  ): ThreadBackdropGround {
    return {
      type: "gradient",
      stops,
      angle: 90,
      shape: "linear",
      size: null,
      repeat: false,
    };
  }

  it("places bare stops evenly by index", () => {
    const style = groundStyleOf(
      linearGradient([
        { at: null, color: "red" },
        { at: null, color: "blue" },
        { at: 0.9, color: "green" },
        { at: null, color: "white" },
      ]),
    );
    expect(style.backgroundImage).toBe(
      "linear-gradient(90deg, red 0%, blue 33.33%, green 90%, white 100%)",
    );
  });

  it("draws no gradient whose stops run backwards", () => {
    expect(
      groundOf(
        linearGradient([
          { at: 0.6, color: "red" },
          { at: 0.2, color: "blue" },
        ]),
      ),
    ).toBeNull();
    expect(
      groundOf(
        linearGradient([
          { at: null, color: "red" },
          { at: null, color: "blue" },
          { at: 0.2, color: "green" },
        ]),
      ),
    ).toBeNull();
  });

  it("draws no gradient when any stop color is unsafe", () => {
    expect(
      groundOf(
        linearGradient([
          { at: 0, color: "red" },
          { at: 0.5, color: "blue" },
          { at: 1, color: "red;position:fixed" },
        ]),
      ),
    ).toBeNull();
  });

  it("stretches an inline vector with even-odd fills and stroked paths", () => {
    const svg = groundOf({
      type: "vector",
      viewBox: [10, 10],
      paths: [
        { d: "M0 0H10V10H0Z M2 2H8V8H2Z", strokeWidth: null, color: null },
        { d: "M0 0L10 10", strokeWidth: 2, color: "border-accent" },
        { d: "M0 0L1 1", strokeWidth: null, color: "url(#x)" },
        { d: "M0 0 url(javascript:alert(1))", strokeWidth: null, color: null },
      ],
      color: "red",
      size: null,
      repeat: false,
    });
    expect(svg?.tagName.toLowerCase()).toBe("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg?.querySelector("pattern")).toBeNull();
    const paths = [...(svg?.querySelectorAll("path") ?? [])];
    expect(paths).toHaveLength(2);
    expect(paths[0]?.getAttribute("style")).toContain("fill-rule: evenodd");
    expect(paths[0]?.getAttribute("style")).toContain("fill: red");
    expect(paths[1]?.getAttribute("style")).toContain("fill: none");
    expect(paths[1]?.getAttribute("style")).toContain(
      "stroke: color-mix(in oklab, var(--timeline-accent) 40%, transparent)",
    );
    expect(paths[1]?.getAttribute("style")).toContain("stroke-width: 2");
    expect(svg?.outerHTML).not.toContain("javascript");
  });

  it("tiles a repeating vector through a user-space pattern", () => {
    const svg = groundOf({
      type: "vector",
      viewBox: [8, 8],
      paths: [{ d: "M0 0H4V4H0Z", strokeWidth: null, color: "text-muted" }],
      color: null,
      size: [16, 16],
      repeat: true,
    });
    const pattern = svg?.querySelector("pattern");
    expect(pattern?.getAttribute("patternUnits")).toBe("userSpaceOnUse");
    expect(pattern?.getAttribute("width")).toBe("16");
    expect(pattern?.getAttribute("viewBox")).toBe("0 0 8 8");
    expect(svg?.querySelector("rect")?.getAttribute("fill")).toBe(
      `url(#${pattern?.getAttribute("id")})`,
    );
  });

  it("draws no vector whose paths have no color", () => {
    expect(
      groundOf({
        type: "vector",
        viewBox: [8, 8],
        paths: [{ d: "M0 0H4V4H0Z", strokeWidth: null, color: null }],
        color: null,
        size: null,
        repeat: false,
      }),
    ).toBeNull();
  });

  it("paints an image ground from its base64 data", () => {
    const stretched = groundStyleOf({
      type: "image",
      mime: "image/png",
      dataBase64: "iVBORw0KGgo=",
      width: 32,
      height: 16,
      size: null,
      repeat: false,
    });
    expect(stretched.backgroundImage).toBe(
      'url("data:image/png;base64,iVBORw0KGgo=")',
    );
    expect(stretched.backgroundSize).toBe("100% 100%");
    cleanup();
    const tiled = groundStyleOf({
      type: "image",
      mime: "image/jpeg",
      dataBase64: "AAAA",
      width: 32,
      height: 16,
      size: null,
      repeat: true,
    });
    expect(tiled.backgroundSize).toBe("auto");
    expect(tiled.backgroundRepeat).toBe("repeat");
    cleanup();
    const sized = groundStyleOf({
      type: "image",
      mime: "image/jpeg",
      dataBase64: "AAAA",
      width: 32,
      height: 16,
      size: [8, 4],
      repeat: true,
    });
    expect(sized.backgroundSize).toBe("8px 4px");
  });

  it("refuses image data that is not plain base64", () => {
    expect(
      groundOf({
        type: "image",
        mime: "image/png",
        dataBase64: 'AAAA"),url(javascript:alert(1)',
        width: 1,
        height: 1,
        size: null,
        repeat: false,
      }),
    ).toBeNull();
  });

  it("draws the ground beneath the tree", () => {
    const layer = renderLayer(
      backdropWith({
        ground: { type: "color", color: "blue" },
        tree: { type: "Box", props: {}, children: ["Over"] },
      }),
    );
    const ground = layer.querySelector("[data-thread-backdrop-ground]");
    const box = layer.querySelector('[data-thread-backdrop-node="Box"]');
    expect(ground?.nextElementSibling).toBe(box);
  });
});

describe("thread backdrop presence and color scheme", () => {
  it("draws no layer for a null backdrop or one with nothing to draw", () => {
    expect(hasThreadBackdropLayer(null)).toBe(false);
    expect(hasThreadBackdropLayer(backdropWith({ colorScheme: "dark" }))).toBe(
      false,
    );
    expect(
      hasThreadBackdropLayer(
        backdropWith({ tree: { type: "Box", props: {}, children: [] } }),
      ),
    ).toBe(true);
    expect(
      hasThreadBackdropLayer(
        backdropWith({ scene: null, ground: { type: "color", color: "red" } }),
      ),
    ).toBe(true);
  });

  it("applies a scheme-only backdrop without drawing a layer", () => {
    const backdrop = backdropWith({ scene: null, colorScheme: "light" });
    expect(hasThreadBackdropLayer(backdrop)).toBe(false);
    expect(
      threadBackdropColorSchemeClassName(backdrop.colorScheme)?.split(" "),
    ).toContain("light");
  });

  it("scopes a forced scheme to the thread window with its own canvas", () => {
    const dark = threadBackdropColorSchemeClassName("dark")?.split(" ") ?? [];
    expect(dark).toContain("dark");
    expect(dark).toContain("bg-background");
    expect(dark).toContain("text-foreground");
    expect(threadBackdropColorSchemeClassName("light")?.split(" ")).toContain(
      "light",
    );
    expect(threadBackdropColorSchemeClassName(null)).toBeUndefined();
  });

  describe("dark: variant inside a forced scheme", () => {
    const variant = /@custom-variant dark \(&(.+)\);/.exec(themeCss)?.[1];

    function darkVariantMatches(
      rootClass: "dark" | null,
      colorScheme: "light" | "dark" | null,
    ): boolean {
      if (variant === undefined) throw new Error("dark variant missing");
      document.documentElement.className = rootClass ?? "";
      const { container } = render(
        <div className={threadBackdropColorSchemeClassName(colorScheme)}>
          <span data-testid="probe" />
        </div>,
      );
      const probe = container.querySelector("[data-testid='probe']");
      if (probe === null) throw new Error("probe missing");
      return probe.matches(`*${variant}`);
    }

    afterEach(() => {
      document.documentElement.className = "";
    });

    it("stops applying under a forced light thread window in a dark app", () => {
      expect(darkVariantMatches("dark", "light")).toBe(false);
    });

    it("keeps applying in a dark app without a forced scheme", () => {
      expect(darkVariantMatches("dark", null)).toBe(true);
    });

    it("applies under a forced dark thread window in a light app", () => {
      expect(darkVariantMatches(null, "dark")).toBe(true);
      expect(darkVariantMatches(null, null)).toBe(false);
    });
  });
});

describe("PageShell with a backdrop", () => {
  function renderShell(backdrop: ThreadBackdrop | null): string {
    vi.stubGlobal("CSS", { supports: () => false });
    return renderToStaticMarkup(
      <PageShell
        scrollBehavior="bottom-anchor"
        scrollAnchorThreadId="thread-a"
        footer={<div>Composer</div>}
        backdrop={
          hasThreadBackdropLayer(backdrop) ? (
            <ThreadBackdropLayer backdrop={backdrop} />
          ) : undefined
        }
      >
        <div>row</div>
      </PageShell>,
    );
  }

  it("keeps the opaque footer when no backdrop is set", () => {
    const markup = renderShell(null);
    expect(markup).not.toContain("data-thread-backdrop");
    expect(markup).toContain("bg-background");
    expect(markup).toContain("data-overflow-fade");
  });

  it("clears the footer canvas and isolates the stack behind a backdrop", () => {
    const markup = renderShell(
      backdropWith({ tree: { type: "Box", props: {}, children: [] } }),
    );
    expect(markup).toContain("data-thread-backdrop");
    expect(markup).not.toContain("bg-background");
    expect(markup).not.toContain("data-overflow-fade");
    expect(markup).toContain("isolate");
  });
});

describe("thread backdrop style resolution", () => {
  it("accepts raw and theme colors and rejects everything else", () => {
    expect(resolveThreadBackdropColor("#1a2b3c")).toBe("#1a2b3c");
    expect(resolveThreadBackdropColor("rgb(10 20 30 / 50%)")).toBe(
      "rgb(10 20 30 / 50%)",
    );
    expect(resolveThreadBackdropColor("hsl(210deg, 50%, 40%)")).toBe(
      "hsl(210deg, 50%, 40%)",
    );
    expect(resolveThreadBackdropColor("MidnightBlue")).toBe("midnightblue");
    expect(resolveThreadBackdropColor("text")).toBe("var(--foreground)");
    expect(resolveThreadBackdropColor("surface-0")).toBe("var(--background)");
    expect(resolveThreadBackdropColor("text-muted")).toBe(
      "var(--subtle-foreground)",
    );
    expect(resolveThreadBackdropColor("bg-success")).toBe(
      "color-mix(in oklab, var(--success) 14%, transparent)",
    );
    expect(resolveThreadBackdropColor("on-danger")).toBe(
      "var(--destructive-foreground)",
    );
    expect(resolveThreadBackdropColor("fill-pro")).toBe(
      "var(--palette-purple)",
    );
    expect(resolveThreadBackdropColor("fill-unknown")).toBeUndefined();
    expect(resolveThreadBackdropColor("rgb(1,2,3);color:red")).toBeUndefined();
    expect(resolveThreadBackdropColor("var(--canvas)")).toBeUndefined();
    expect(resolveThreadBackdropColor("notacolor")).toBeUndefined();
  });

  it("maps cell counts and spacing steps to CSS lengths", () => {
    const style = threadBackdropBoxStyle(
      { width: 10, height: 3, paddingX: "md", marginTop: 2, gap: 1 },
      "flex",
    );
    expect(style.width).toBe("10ch");
    expect(style.height).toBe("3lh");
    expect(style.paddingLeft).toBe("0.75rem");
    expect(style.paddingRight).toBe("0.75rem");
    expect(style.paddingTop).toBeUndefined();
    expect(style.marginTop).toBe("2lh");
    expect(style.columnGap).toBe("1ch");
    expect(style.rowGap).toBe("1lh");
  });
});
