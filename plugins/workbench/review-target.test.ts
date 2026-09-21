import { describe, expect, it } from "vitest";
import { ROUTING_FIXTURE_ENTRIES } from "./__fixtures__/routing.js";
import {
  resolveReviewTarget,
  resolveRoutedReviewTarget,
} from "./review-target.js";

const CLAUDE = { id: "claude-code" };
const CODEX = { id: "codex" };
const PI = { id: "pi" };

const CATALOGS: Record<string, { model: string; isDefault: boolean }[]> = {
  "claude-code": [
    { model: "claude-sonnet-5", isDefault: true },
    { model: "claude-fable-5-1", isDefault: false },
  ],
  codex: [
    { model: "gpt-5", isDefault: true },
    { model: "gpt-5.6-sol", isDefault: false },
  ],
  pi: [{ model: "pi-model", isDefault: true }],
};

async function loadModels(providerId: string) {
  return CATALOGS[providerId] ?? [];
}

describe("resolveReviewTarget auto", () => {
  it("uses the cross-vendor row when codex is available and lists the model", async () => {
    await expect(
      resolveReviewTarget({
        request: { kind: "auto" },
        entries: ROUTING_FIXTURE_ENTRIES,
        available: [CLAUDE, CODEX],
        threadProviderId: "claude-code",
        loadModels,
      }),
    ).resolves.toEqual({
      ok: true,
      provider: CODEX,
      model: { model: "gpt-5.6-sol", isDefault: false },
      effort: "high",
      source: "routing-cross-vendor",
    });
  });

  it("falls back to the in-thread reviewer row when codex is unavailable", async () => {
    await expect(
      resolveReviewTarget({
        request: { kind: "auto" },
        entries: ROUTING_FIXTURE_ENTRIES,
        available: [CLAUDE, PI],
        threadProviderId: "claude-code",
        loadModels,
      }),
    ).resolves.toMatchObject({
      ok: true,
      provider: CLAUDE,
      model: { model: "claude-fable-5-1" },
      effort: "high",
      source: "routing-subagent",
    });
  });

  it("falls back to the in-thread reviewer row when codex lacks the routed model", async () => {
    await expect(
      resolveReviewTarget({
        request: { kind: "auto" },
        entries: ROUTING_FIXTURE_ENTRIES,
        available: [CLAUDE, CODEX],
        threadProviderId: "claude-code",
        loadModels: async (providerId) =>
          providerId === "codex"
            ? [{ model: "gpt-5", isDefault: true }]
            : loadModels(providerId),
      }),
    ).resolves.toMatchObject({ ok: true, source: "routing-subagent" });
  });

  it("uses the first other provider's default model without ROUTING.md", async () => {
    await expect(
      resolveReviewTarget({
        request: { kind: "auto" },
        entries: [],
        available: [CLAUDE, PI],
        threadProviderId: "claude-code",
        loadModels,
      }),
    ).resolves.toEqual({
      ok: true,
      provider: PI,
      model: { model: "pi-model", isDefault: true },
      effort: null,
      source: "fallback",
    });
  });

  it("falls back when no routed provider resolves and a catalog load throws", async () => {
    await expect(
      resolveReviewTarget({
        request: { kind: "auto" },
        entries: ROUTING_FIXTURE_ENTRIES,
        available: [CLAUDE, PI],
        threadProviderId: "claude-code",
        loadModels: async (providerId) => {
          if (providerId === "claude-code") throw new Error("offline");
          return loadModels(providerId);
        },
      }),
    ).resolves.toMatchObject({ ok: true, provider: PI, source: "fallback" });
  });

  it("errors when nothing other than the thread's provider is available", async () => {
    await expect(
      resolveReviewTarget({
        request: { kind: "auto" },
        entries: [],
        available: [CLAUDE],
        threadProviderId: "claude-code",
        loadModels,
      }),
    ).resolves.toEqual({ ok: false, error: "no_provider_available" });
  });
});

describe("resolveRoutedReviewTarget without a thread", () => {
  it("resolves a ROUTING.md reviewer row", async () => {
    await expect(
      resolveRoutedReviewTarget({
        request: { kind: "auto" },
        entries: ROUTING_FIXTURE_ENTRIES,
        available: [CLAUDE, CODEX],
        loadModels,
      }),
    ).resolves.toMatchObject({ ok: true, source: "routing-cross-vendor" });
  });

  it("returns null instead of guessing a provider when no reviewer row resolves", async () => {
    await expect(
      resolveRoutedReviewTarget({
        request: { kind: "auto" },
        entries: [],
        available: [CLAUDE, PI],
        loadModels,
      }),
    ).resolves.toBeNull();
  });

  it("still resolves an explicit provider", async () => {
    await expect(
      resolveRoutedReviewTarget({
        request: { kind: "provider", providerId: "pi" },
        entries: [],
        available: [CLAUDE, PI],
        loadModels,
      }),
    ).resolves.toMatchObject({ ok: true, source: "provider-default" });
  });
});

describe("resolveReviewTarget explicit provider", () => {
  it("uses the ROUTING.md model a row names for that provider", async () => {
    await expect(
      resolveReviewTarget({
        request: { kind: "provider", providerId: "claude-code" },
        entries: ROUTING_FIXTURE_ENTRIES,
        available: [CLAUDE, CODEX],
        threadProviderId: "claude-code",
        loadModels,
      }),
    ).resolves.toMatchObject({
      ok: true,
      provider: CLAUDE,
      model: { model: "claude-fable-5-1" },
      effort: "high",
      source: "routing-subagent",
    });
  });

  it("uses the provider default when no row names it", async () => {
    await expect(
      resolveReviewTarget({
        request: { kind: "provider", providerId: "pi" },
        entries: ROUTING_FIXTURE_ENTRIES,
        available: [CLAUDE, PI],
        threadProviderId: "claude-code",
        loadModels,
      }),
    ).resolves.toMatchObject({
      ok: true,
      provider: PI,
      model: { model: "pi-model" },
      effort: null,
      source: "provider-default",
    });
  });

  it("rejects a provider that is not available", async () => {
    await expect(
      resolveReviewTarget({
        request: { kind: "provider", providerId: "codex" },
        entries: ROUTING_FIXTURE_ENTRIES,
        available: [CLAUDE],
        threadProviderId: "claude-code",
        loadModels,
      }),
    ).resolves.toEqual({ ok: false, error: "provider_unavailable" });
  });
});
