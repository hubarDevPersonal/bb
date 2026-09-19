export const IDENTITY_PALETTE_COLORS = [
  "blue",
  "green",
  "orange",
  "purple",
  "yellow",
  "pink",
] as const;

export type IdentityPaletteColor = (typeof IDENTITY_PALETTE_COLORS)[number];

export function identityColorForId(id: string): IdentityPaletteColor {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return IDENTITY_PALETTE_COLORS[
    (hash >>> 0) % IDENTITY_PALETTE_COLORS.length
  ]!;
}

export const IDENTITY_TEXT_COLOR_CLASS: Readonly<
  Record<IdentityPaletteColor, string>
> = {
  blue: "text-palette-blue",
  green: "text-palette-green",
  orange: "text-palette-orange",
  purple: "text-palette-purple",
  yellow: "text-palette-yellow",
  pink: "text-palette-pink",
};

export const IDENTITY_BG_COLOR_CLASS: Readonly<
  Record<IdentityPaletteColor, string>
> = {
  blue: "bg-palette-blue",
  green: "bg-palette-green",
  orange: "bg-palette-orange",
  purple: "bg-palette-purple",
  yellow: "bg-palette-yellow",
  pink: "bg-palette-pink",
};
