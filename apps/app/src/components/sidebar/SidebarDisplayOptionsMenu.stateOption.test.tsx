// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultAppSettings, type AppSettings } from "@bb/domain";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { SidebarDisplayOptionsMenu } from "./ProjectList";
import { sidebarOrganizationModeAtom } from "./sidebarCollapsedAtoms";

const mockState = vi.hoisted(() => ({
  settings: undefined as AppSettings | undefined,
}));

vi.mock("@/lib/sdk", async () => {
  const { defaultAppSettings } = await import("@bb/domain");
  const { makeSystemConfig } = await import("@/test/fixtures/system-config");
  mockState.settings = defaultAppSettings;
  return {
    sdk: {
      system: {
        config: vi.fn(async () =>
          makeSystemConfig({ generalSettings: mockState.settings }),
        ),
        updateGeneralSettings: vi.fn(async (next: AppSettings) => {
          mockState.settings = next;
          return next;
        }),
      },
    },
  };
});

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

function renderMenu(store = createStore()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const result = render(
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <SidebarDisplayOptionsMenu open onOpenChange={() => {}} />
        </TooltipProvider>
      </QueryClientProvider>
    </JotaiProvider>,
  );
  return { ...result, store };
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  mockState.settings = defaultAppSettings;
});

describe("SidebarDisplayOptionsMenu By state option", () => {
  it("is unchecked while the existing organize option is checked by default", async () => {
    renderMenu();
    const byState = await screen.findByRole("menuitemcheckbox", {
      name: "By state",
    });
    expect(byState.getAttribute("aria-checked")).toBe("false");
    const byProject = screen.getByRole("menuitemcheckbox", {
      name: "By project",
    });
    expect(byProject.getAttribute("aria-checked")).toBe("true");
  });

  it("writes sidebarGroupByState true when picked", async () => {
    const { sdk } = await import("@/lib/sdk");
    renderMenu();
    const byState = await screen.findByRole("menuitemcheckbox", {
      name: "By state",
    });
    await waitFor(() =>
      expect(byState.getAttribute("aria-disabled")).not.toBe("true"),
    );
    fireEvent.click(byState);
    await waitFor(() =>
      expect(sdk.system.updateGeneralSettings).toHaveBeenCalledWith(
        expect.objectContaining({ sidebarGroupByState: true }),
      ),
    );
  });

  it("shows By state checked and By project unchecked when the setting starts true", async () => {
    mockState.settings = { ...defaultAppSettings, sidebarGroupByState: true };
    renderMenu();
    const byState = await screen.findByRole("menuitemcheckbox", {
      name: "By state",
    });
    await waitFor(() =>
      expect(byState.getAttribute("aria-checked")).toBe("true"),
    );
    const byProject = screen.getByRole("menuitemcheckbox", {
      name: "By project",
    });
    expect(byProject.getAttribute("aria-checked")).toBe("false");
  });

  it("picking By project clears sidebarGroupByState and sets the organize atom", async () => {
    const { sdk } = await import("@/lib/sdk");
    mockState.settings = { ...defaultAppSettings, sidebarGroupByState: true };
    const store = createStore();
    store.set(sidebarOrganizationModeAtom, "machine");
    renderMenu(store);
    const byState = await screen.findByRole("menuitemcheckbox", {
      name: "By state",
    });
    await waitFor(() =>
      expect(byState.getAttribute("aria-checked")).toBe("true"),
    );
    const byProject = screen.getByRole("menuitemcheckbox", {
      name: "By project",
    });
    fireEvent.click(byProject);
    expect(store.get(sidebarOrganizationModeAtom)).toBe("project");
    await waitFor(() =>
      expect(sdk.system.updateGeneralSettings).toHaveBeenCalledWith(
        expect.objectContaining({ sidebarGroupByState: false }),
      ),
    );
  });
});
