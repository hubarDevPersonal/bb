import type { CSSProperties } from "react";
import type { ThreadBackdropGround } from "@bb/domain";
import { resolveThreadBackdropColor } from "./thread-backdrop-style";

type GradientGround = Extract<ThreadBackdropGround, { type: "gradient" }>;
type ImageGround = Extract<ThreadBackdropGround, { type: "image" }>;
type VectorGround = Extract<ThreadBackdropGround, { type: "vector" }>;
type TileSize = readonly [number, number];

const PATH_DATA_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_MIMES: readonly ImageGround["mime"][] = ["image/jpeg", "image/png"];

export interface ThreadBackdropVectorPath {
  d: string;
  style: CSSProperties;
}

function tilingStyle(
  repeat: boolean,
  tile: TileSize | null,
  ownSize: "auto" | "100% 100%",
): Pick<CSSProperties, "backgroundRepeat" | "backgroundSize"> {
  if (!repeat) {
    return { backgroundRepeat: "no-repeat", backgroundSize: "100% 100%" };
  }
  return {
    backgroundRepeat: "repeat",
    backgroundSize: tile === null ? ownSize : `${tile[0]}px ${tile[1]}px`,
  };
}

function gradientImage(ground: GradientGround): string | undefined {
  const count = ground.stops.length;
  if (count < 2) return undefined;
  const stops: string[] = [];
  let previous = 0;
  for (const [index, stop] of ground.stops.entries()) {
    const color = resolveThreadBackdropColor(stop.color);
    if (color === undefined) return undefined;
    const position = stop.at ?? index / (count - 1);
    if (position < previous) return undefined;
    previous = position;
    stops.push(`${color} ${Math.round(position * 10000) / 100}%`);
  }
  return ground.shape === "linear"
    ? `linear-gradient(${ground.angle}deg, ${stops.join(", ")})`
    : `radial-gradient(closest-side, ${stops.join(", ")})`;
}

function imageSource(ground: ImageGround): string | undefined {
  if (!IMAGE_MIMES.includes(ground.mime)) return undefined;
  if (!BASE64_PATTERN.test(ground.dataBase64)) return undefined;
  return `url("data:${ground.mime};base64,${ground.dataBase64}")`;
}

export function threadBackdropGroundStyle(
  ground: Exclude<ThreadBackdropGround, VectorGround>,
): CSSProperties | null {
  switch (ground.type) {
    case "color": {
      const backgroundColor = resolveThreadBackdropColor(ground.color);
      return backgroundColor === undefined ? null : { backgroundColor };
    }
    case "gradient": {
      const backgroundImage = gradientImage(ground);
      return backgroundImage === undefined
        ? null
        : {
            backgroundImage,
            ...tilingStyle(ground.repeat, ground.size, "100% 100%"),
          };
    }
    case "image": {
      const backgroundImage = imageSource(ground);
      return backgroundImage === undefined
        ? null
        : {
            backgroundImage,
            ...tilingStyle(ground.repeat, ground.size, "auto"),
          };
    }
  }
}

export function threadBackdropVectorPaths(
  ground: VectorGround,
): ThreadBackdropVectorPath[] {
  const paths: ThreadBackdropVectorPath[] = [];
  for (const path of ground.paths) {
    if (!PATH_DATA_PATTERN.test(path.d)) continue;
    const color = resolveThreadBackdropColor(path.color ?? ground.color);
    if (color === undefined) continue;
    paths.push({
      d: path.d,
      style:
        path.strokeWidth === null
          ? { fill: color, fillRule: "evenodd", stroke: "none" }
          : {
              fill: "none",
              stroke: color,
              strokeWidth: path.strokeWidth,
              vectorEffect: "non-scaling-stroke",
            },
    });
  }
  return paths;
}
