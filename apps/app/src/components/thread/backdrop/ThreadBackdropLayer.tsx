import { Component, useId, type CSSProperties, type ReactNode } from "react";
import {
  THREAD_BACKDROP_MAX_DEPTH,
  THREAD_BACKDROP_MAX_NODES,
  type ThreadBackdrop,
  type ThreadBackdropChild,
  type ThreadBackdropColorScheme,
  type ThreadBackdropContainerNode,
  type ThreadBackdropGlass,
  type ThreadBackdropGround,
  type ThreadBackdropNode,
  type ThreadBackdropSvgNode,
} from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  threadBackdropBoxStyle,
  threadBackdropGlassFill,
  threadBackdropTextPresentation,
} from "./thread-backdrop-style";
import {
  threadBackdropGroundStyle,
  threadBackdropVectorPaths,
} from "./thread-backdrop-ground";

type VectorGround = Extract<ThreadBackdropGround, { type: "vector" }>;

type NodePlacement = "root" | "only-child" | "child";

interface RenderBudget {
  remaining: number;
}

export function hasThreadBackdropLayer(
  backdrop: ThreadBackdrop | null,
): backdrop is ThreadBackdrop {
  return (
    backdrop !== null &&
    (backdrop.ground !== null ||
      backdrop.tree !== null ||
      backdrop.glass !== null)
  );
}

export function threadBackdropColorSchemeClassName(
  colorScheme: ThreadBackdropColorScheme | null,
): string | undefined {
  if (colorScheme === null) return undefined;
  return cn(colorScheme, "bg-background text-foreground");
}

export function ThreadBackdropLayer({
  backdrop,
}: {
  backdrop: ThreadBackdrop;
}) {
  return (
    <div
      aria-hidden
      data-thread-backdrop=""
      data-thread-backdrop-scene={backdrop.scene ?? undefined}
      data-thread-backdrop-source={backdrop.source}
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden select-none"
    >
      <ThreadBackdropErrorBoundary backdrop={backdrop}>
        {backdrop.ground === null ? null : (
          <ThreadBackdropGroundLayer ground={backdrop.ground} />
        )}
        {backdrop.tree === null ? null : (
          <ThreadBackdropTree tree={backdrop.tree} />
        )}
      </ThreadBackdropErrorBoundary>
      {backdrop.glass === null ? null : (
        <ThreadBackdropGlassLayer glass={backdrop.glass} />
      )}
    </div>
  );
}

interface ThreadBackdropErrorBoundaryProps {
  backdrop: ThreadBackdrop;
  children: ReactNode;
}

interface ThreadBackdropErrorBoundaryState {
  backdrop: ThreadBackdrop;
  failed: boolean;
}

class ThreadBackdropErrorBoundary extends Component<
  ThreadBackdropErrorBoundaryProps,
  ThreadBackdropErrorBoundaryState
> {
  override state: ThreadBackdropErrorBoundaryState = {
    backdrop: this.props.backdrop,
    failed: false,
  };

  static getDerivedStateFromError(): Partial<ThreadBackdropErrorBoundaryState> {
    return { failed: true };
  }

  static getDerivedStateFromProps(
    props: ThreadBackdropErrorBoundaryProps,
    state: ThreadBackdropErrorBoundaryState,
  ): Partial<ThreadBackdropErrorBoundaryState> | null {
    return props.backdrop === state.backdrop
      ? null
      : { backdrop: props.backdrop, failed: false };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function ThreadBackdropTree({ tree }: { tree: ThreadBackdropNode }) {
  const budget: RenderBudget = { remaining: THREAD_BACKDROP_MAX_NODES };
  return renderNode(tree, 0, "root", budget);
}

function ThreadBackdropGroundLayer({
  ground,
}: {
  ground: ThreadBackdropGround;
}) {
  if (ground.type === "vector") {
    return <ThreadBackdropVectorLayer ground={ground} />;
  }
  const style = threadBackdropGroundStyle(ground);
  if (style === null) return null;
  return (
    <div
      data-thread-backdrop-ground={ground.type}
      className="absolute inset-0"
      style={style}
    />
  );
}

function ThreadBackdropVectorLayer({ ground }: { ground: VectorGround }) {
  const patternId = `thread-backdrop-tile-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const paths = threadBackdropVectorPaths(ground);
  if (paths.length === 0) return null;
  const [viewWidth, viewHeight] = ground.viewBox;
  const viewBox = `0 0 ${viewWidth} ${viewHeight}`;
  const drawing = paths.map((path, index) => (
    <path key={index} d={path.d} style={path.style} />
  ));
  if (!ground.repeat) {
    return (
      <svg
        data-thread-backdrop-ground="vector"
        className="absolute inset-0 size-full"
        viewBox={viewBox}
        preserveAspectRatio="none"
      >
        {drawing}
      </svg>
    );
  }
  const [tileWidth, tileHeight] = ground.size ?? ground.viewBox;
  return (
    <svg
      data-thread-backdrop-ground="vector"
      className="absolute inset-0 size-full"
    >
      <defs>
        <pattern
          id={patternId}
          patternUnits="userSpaceOnUse"
          width={tileWidth}
          height={tileHeight}
          viewBox={viewBox}
          preserveAspectRatio="none"
        >
          {drawing}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}

function ThreadBackdropGlassLayer({ glass }: { glass: ThreadBackdropGlass }) {
  const style = {
    "--thread-backdrop-glass-blur": `${glass.blur}px`,
    "--thread-backdrop-glass-fill": threadBackdropGlassFill(
      glass.tint,
      glass.opacity,
    ),
  } as CSSProperties;
  return (
    <div
      data-thread-backdrop-glass=""
      className="absolute inset-0 bg-(--thread-backdrop-glass-fill) backdrop-blur-(--thread-backdrop-glass-blur)"
      style={style}
    />
  );
}

function renderChildren(
  children: readonly ThreadBackdropChild[],
  depth: number,
  budget: RenderBudget,
): ReactNode[] {
  const placement: NodePlacement =
    children.length === 1 ? "only-child" : "child";
  return children.map((child, index) =>
    typeof child === "string"
      ? child
      : renderNode(child, depth + 1, placement, budget, index),
  );
}

function renderNode(
  node: ThreadBackdropNode,
  depth: number,
  placement: NodePlacement,
  budget: RenderBudget,
  key?: number,
): ReactNode {
  if (depth >= THREAD_BACKDROP_MAX_DEPTH || budget.remaining <= 0) {
    return null;
  }
  budget.remaining -= 1;
  if (node.type === "Svg") {
    return <BackdropSvg key={key} node={node} placement={placement} />;
  }
  return renderContainer(node, depth, placement, budget, key);
}

function renderContainer(
  node: ThreadBackdropContainerNode,
  depth: number,
  placement: NodePlacement,
  budget: RenderBudget,
  key: number | undefined,
): ReactNode {
  const children = renderChildren(node.children, depth, budget);
  const rootStyle: CSSProperties =
    placement === "root" ? { width: "100%", height: "100%" } : {};
  switch (node.type) {
    case "Box":
    case "div": {
      const style = {
        ...rootStyle,
        ...threadBackdropBoxStyle(
          node.props,
          node.type === "Box" ? "flex" : "block",
        ),
      };
      return (
        <div key={key} data-thread-backdrop-node={node.type} style={style}>
          {children}
        </div>
      );
    }
    case "Text":
    case "span":
    case "b": {
      const presentation = threadBackdropTextPresentation(node.props);
      const Element = node.type === "b" ? "b" : "span";
      return (
        <Element
          key={key}
          data-thread-backdrop-node={node.type}
          className={cn(
            placement === "root" && "block",
            presentation.className,
          )}
          style={{ ...rootStyle, ...presentation.style }}
        >
          {children}
        </Element>
      );
    }
  }
}

function BackdropSvg({
  node,
  placement,
}: {
  node: ThreadBackdropSvgNode;
  placement: NodePlacement;
}) {
  const fills =
    placement !== "child" && node.width === null && node.height === null;
  const style: CSSProperties = fills
    ? { width: "100%", height: "100%", objectFit: "cover" }
    : {
        width: node.width ?? undefined,
        height: node.height ?? undefined,
        maxWidth: "100%",
      };
  return (
    <img
      data-thread-backdrop-node="Svg"
      alt={node.alt}
      draggable={false}
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(node.source)}`}
      className="block"
      style={style}
    />
  );
}
