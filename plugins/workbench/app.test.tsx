// @vitest-environment jsdom

import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(() => cleanup());

describe("workbench security route", () => {
  function routeBanner() {
    const customization = app.composerCustomizations.find(
      (candidate) => candidate.id === "workbench-security-route",
    );
    if (customization === undefined) {
      throw new Error("expected the security route customization");
    }
    const banner = customization.banners?.[0];
    if (banner === undefined) throw new Error("expected the route banner");
    return banner;
  }

  it("selects and shows the cross-vendor security model for a new thread", async () => {
    const slot = renderSlot(
      routeBanner(),
      {},
      {
        composer: { scope: { kind: "new-thread", projectId: null } },
        rpc: {
          getSecurityMode: () => ({ enabled: true }),
          securityExecutionTarget: () => ({
            ok: true,
            providerId: "codex",
            model: "gpt-5.6-sol",
            reasoningLevel: "high",
          }),
        },
      },
    );

    await slot.findByText("Security mode · codex / gpt-5.6-sol");
    expect(slot.composer.selections).toEqual([
      {
        providerId: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "high",
      },
    ]);
  });

  it("shows a route failure without changing the composer selection", async () => {
    const slot = renderSlot(
      routeBanner(),
      {},
      {
        composer: { scope: { kind: "new-thread", projectId: null } },
        rpc: {
          getSecurityMode: () => ({ enabled: true }),
          securityExecutionTarget: () => ({
            ok: false,
            error: "routing_unavailable",
          }),
        },
      },
    );

    await slot.findByText("Security provider unavailable: routing_unavailable");
    expect(slot.composer.selections).toEqual([]);
  });
});
