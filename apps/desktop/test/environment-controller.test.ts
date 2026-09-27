import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import {
  createEnvironmentController,
  type EnvironmentController,
  type EnvironmentTunnels,
} from "../src/environment-controller.js";

const ENVIRONMENTS = {
  environments: [
    { id: "mac", name: "MacBook" },
    {
      id: "vps",
      name: "VPS",
      ssh: { destination: "artem@vps", localPort: 38901 },
    },
    {
      id: "stage",
      name: "Stage",
      ssh: { destination: "artem@stage", localPort: 38902 },
    },
  ],
};

type Target =
  | { kind: "builtin" }
  | { kind: "connect" }
  | { kind: "custom"; url: string };

const cleanups: Array<() => Promise<void>> = [];
const controllers: EnvironmentController[] = [];

afterEach(async () => {
  for (const controller of controllers.splice(0)) controller.dispose();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function setup() {
  const userDataPath = await mkdtemp(join(tmpdir(), "bb-env-controller-"));
  cleanups.push(() => rm(userDataPath, { recursive: true, force: true }));
  await writeFile(
    join(userDataPath, "environments.json"),
    JSON.stringify(ENVIRONMENTS),
  );
  let target: Target = { kind: "builtin" };
  const tunnels = {
    ensure: vi.fn(
      async (environment: { ssh: { localPort: number } | null }) => ({
        ok: true as const,
        serverUrl: `http://127.0.0.1:${environment.ssh?.localPort}`,
        startedServer: false,
      }),
    ),
    stop: vi.fn(),
    stopAll: vi.fn(),
  };
  const openInNewWindow = vi.fn();
  const controller = createEnvironmentController({
    userDataPath,
    getTarget: () => target,
    selectBuiltin: vi.fn(async () => {
      target = { kind: "builtin" };
    }),
    selectServerUrl: vi.fn(async (url: string) => {
      target = { kind: "custom", url };
    }),
    openPath: vi.fn(async () => ""),
    showError: vi.fn(),
    onEnvironmentsChanged: vi.fn(),
    openInNewWindow,
    log: vi.fn(),
    tunnels: tunnels as unknown as EnvironmentTunnels,
  });
  controllers.push(controller);
  await controller.load();
  return {
    controller,
    tunnels,
    openInNewWindow,
    setTarget(next: Target) {
      target = next;
    },
  };
}

function labels(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => (item.label ? [item.label] : []));
}

describe("environment controller", () => {
  it("keeps a retained environment's tunnel while the main target moves elsewhere", async () => {
    const { controller, tunnels } = await setup();

    await controller.retain("stage");
    await controller.ensureServerUrl("http://127.0.0.1:38901");
    expect(tunnels.stop).not.toHaveBeenCalledWith("stage");

    await controller.select("mac");
    expect(tunnels.stop).toHaveBeenCalledWith("vps");
    expect(tunnels.stop).not.toHaveBeenCalledWith("stage");

    controller.release("stage");
    expect(tunnels.stop).toHaveBeenCalledWith("stage");
  });

  it("counts retains so a second window keeps the tunnel after the first closes", async () => {
    const { controller, tunnels } = await setup();

    await controller.retain("vps");
    await controller.retain("vps");
    controller.release("vps");
    expect(tunnels.stop).not.toHaveBeenCalledWith("vps");
    controller.release("vps");
    expect(tunnels.stop).toHaveBeenCalledWith("vps");
  });

  it("does not stop the active target's tunnel when a pinned window closes", async () => {
    const { controller, tunnels } = await setup();

    await controller.ensureServerUrl("http://127.0.0.1:38901");
    await controller.retain("vps");
    controller.release("vps");

    expect(tunnels.stop).not.toHaveBeenCalledWith("vps");
  });

  it("offers every environment in a new window and scopes a pinned window's menu", async () => {
    const { controller, openInNewWindow, setTarget } = await setup();
    setTarget({ kind: "custom", url: "http://127.0.0.1:38901" });

    const main = controller.buildMenu({ accelerators: true });
    const openInNew = main.find((item) => item.label === "Open in New Window");
    const submenu = openInNew?.submenu as MenuItemConstructorOptions[];
    expect(submenu.map((item) => [item.label, item.accelerator])).toEqual([
      ["MacBook", "CommandOrControl+Control+Shift+1"],
      ["VPS", "CommandOrControl+Control+Shift+2"],
      ["Stage", "CommandOrControl+Control+Shift+3"],
    ]);
    submenu[2]?.click?.({} as never, undefined as never, {} as never);
    expect(openInNewWindow).toHaveBeenCalledWith("stage");
    expect(labels(main)).toContain("VPS Actions");

    const pinned = controller.buildMenu({
      accelerators: false,
      pinnedEnvironmentId: "stage",
    });
    expect(labels(pinned)[0]).toBe("This window: Stage");
    expect(labels(pinned)).toContain("Stage Actions");
    expect(pinned.some((item) => item.type === "radio")).toBe(false);
  });

  it("describes environments for the renderer", async () => {
    const { controller } = await setup();
    expect(controller.describe("stage")).toEqual({
      id: "stage",
      name: "Stage",
      color: "orange",
      kind: "ssh",
      destination: "artem@stage",
    });
    expect(controller.current()?.id).toBe("mac");
    expect(controller.describe("missing")).toBeNull();
  });
});
