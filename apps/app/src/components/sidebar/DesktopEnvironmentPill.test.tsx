// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BbDesktopEnvironment,
  BbDesktopEnvironmentChangeHandler,
} from "@bb/desktop-contract";
import type { SystemProviderState } from "@bb/server-contract";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import {
  DesktopEnvironmentPill,
  describeProviderAccount,
} from "./DesktopEnvironmentPill";

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemProviderStates: () => ({
    isPending: false,
    data: { providers: [] },
  }),
}));

const VPS: BbDesktopEnvironment = {
  id: "vps",
  name: "VPS",
  color: "green",
  kind: "ssh",
  destination: "artem@host",
};

function installDesktop(initial: BbDesktopEnvironment | null) {
  let listener: BbDesktopEnvironmentChangeHandler | null = null;
  const openEnvironmentMenu = vi.fn();
  window.bbDesktop = {
    ...createBbDesktopApi({
      lastCheckedAt: null,
      latestVersion: null,
      pendingVersion: null,
      platform: "macos",
      updateAvailable: false,
      updateDownloaded: false,
      version: "0.0.0",
    }),
    getEnvironment: async () => initial,
    onEnvironmentChange(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    openEnvironmentMenu,
  };
  return {
    openEnvironmentMenu,
    emit: (environment: BbDesktopEnvironment | null) => listener?.(environment),
  };
}

function providerState(
  overrides: Partial<SystemProviderState>,
): SystemProviderState {
  return {
    providerId: "claude-code",
    displayName: "Claude Code",
    status: "ready",
    statusMessage: null,
    accountEmail: "me@example.com",
    planLabel: "Max",
    installedVersion: null,
    minimumSupportedVersion: null,
    canInstall: false,
    canUpdate: false,
    loginCommand: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  delete window.bbDesktop;
});

describe("DesktopEnvironmentPill", () => {
  it("renders nothing outside the desktop app", () => {
    const { container } = render(
      <TooltipProvider>
        <DesktopEnvironmentPill />
      </TooltipProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("shows the active environment, follows changes, and opens the menu", async () => {
    const desktop = installDesktop(VPS);
    render(
      <TooltipProvider>
        <DesktopEnvironmentPill />
      </TooltipProvider>,
    );

    const pill = await screen.findByTestId("desktop-environment-pill");
    expect(pill.textContent).toBe("VPS");

    fireEvent.click(pill);
    expect(desktop.openEnvironmentMenu).toHaveBeenCalledTimes(1);

    act(() => {
      desktop.emit({
        ...VPS,
        id: "mac",
        name: "This Mac",
        kind: "local",
        destination: null,
      });
    });
    expect(screen.getByTestId("desktop-environment-pill").textContent).toBe(
      "This Mac",
    );

    act(() => {
      desktop.emit(null);
    });
    expect(screen.queryByTestId("desktop-environment-pill")).toBeNull();
  });
});

describe("describeProviderAccount", () => {
  it("names the signed-in account and plan, or why there is none", () => {
    expect(describeProviderAccount(providerState({}))).toBe(
      "me@example.com · Max",
    );
    expect(
      describeProviderAccount(providerState({ status: "unauthenticated" })),
    ).toBe("not signed in");
    expect(
      describeProviderAccount(providerState({ status: "not_installed" })),
    ).toBe("not installed");
  });
});
