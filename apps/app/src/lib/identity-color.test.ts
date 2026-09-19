import { describe, expect, it } from "vitest";
import {
  IDENTITY_BG_COLOR_CLASS,
  IDENTITY_PALETTE_COLORS,
  IDENTITY_TEXT_COLOR_CLASS,
  identityColorForId,
} from "./identity-color";

describe("identityColorForId", () => {
  it("returns a color from the fixed palette", () => {
    expect(IDENTITY_PALETTE_COLORS).toContain(identityColorForId("extensions"));
    expect(IDENTITY_PALETTE_COLORS).toContain(
      identityColorForId("plugin-id/panel-id"),
    );
  });

  it("is deterministic for the same id", () => {
    expect(identityColorForId("workspace")).toBe(
      identityColorForId("workspace"),
    );
  });

  it("varies across different ids", () => {
    const colors = new Set(
      ["workspace", "bb (fork)", "extensions", "automations", "github"].map(
        identityColorForId,
      ),
    );
    expect(colors.size).toBeGreaterThan(1);
  });

  it("has a text and background class for every palette color", () => {
    for (const color of IDENTITY_PALETTE_COLORS) {
      expect(IDENTITY_TEXT_COLOR_CLASS[color]).toBe(`text-palette-${color}`);
      expect(IDENTITY_BG_COLOR_CLASS[color]).toBe(`bg-palette-${color}`);
    }
  });
});
