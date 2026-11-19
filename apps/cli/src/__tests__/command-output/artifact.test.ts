import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerArtifactCommands } from "../../commands/artifact.js";

const ARTIFACT_URL =
  "https://claude.ai/code/artifact/0b3c9a52-6f1e-4d7a-9c1b-2f8e4a6d5c3b";

function host(id: string, status: "connected" | "disconnected") {
  return {
    id,
    name: id,
    type: "persistent",
    status,
    machineProviderId: null,
    lifecycle: {
      phase: "active",
      suspendedAt: null,
      message: null,
      pendingLog: "",
      teardown: null,
    },
    maxPermissionMode: "full",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function windowOn(hostId: string, instanceId: string) {
  return { hostId, instanceId, generation: `gen-${instanceId}`, label: "bb" };
}

function expectError(message: string) {
  expect(collectLogLines(vi.mocked(console.error)).join("\n")).toContain(
    message,
  );
}

function run(args: string[]) {
  return runCommand(["artifact", "open", ...args], (program) =>
    registerArtifactCommands(program, () => "http://server"),
  );
}

describe("artifact open", () => {
  setupCommandOutputTestEnvironment();

  it("opens the artifact in the only connected desktop window for the context thread", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr_ctx");
    const listInstances = vi.fn(
      async ({ json }: { json: { hostId: string } }) => ({
        instances: json.hostId === "desk" ? [windowOn("desk", "win1")] : [],
      }),
    );
    const createTab = vi.fn(async () => ({
      tab: { tabId: "tab1" },
    }));
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        host("desk", "connected"),
        host("cloud", "connected"),
        host("offline", "disconnected"),
      ]),
      "v1.desktop-browsers.instances.$post": listInstances,
      "v1.desktop-browsers.create.$post": createTab,
    });

    await run([ARTIFACT_URL]);

    expect(
      listInstances.mock.calls.map(([input]) => input.json.hostId),
    ).toEqual(["desk", "cloud"]);
    expect(createTab).toHaveBeenCalledWith({
      json: {
        hostId: "desk",
        instanceId: "win1",
        generation: "gen-win1",
        threadId: "thr_ctx",
        url: ARTIFACT_URL,
        presentation: "reveal",
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      `Opened ${ARTIFACT_URL} in tab tab1`,
    ]);
  });

  it("refuses URLs that are not Claude artifacts before contacting the server", async () => {
    const createTab = vi.fn();
    stubServerApi({ "v1.desktop-browsers.create.$post": createTab });

    await expect(
      run(["https://example.com/artifact/abc", "--thread", "thr_1"]),
    ).rejects.toThrow("process.exit:1");
    expectError("Not a Claude artifact URL");
    expect(createTab).not.toHaveBeenCalled();
  });

  it("asks for a window when several desktop windows are connected", async () => {
    const createTab = vi.fn(async () => ({ tab: { tabId: "tab2" } }));
    stubServerApi({
      "v1.desktop-browsers.instances.$post": vi.fn(async () => ({
        instances: [windowOn("desk", "win1"), windowOn("desk", "win2")],
      })),
      "v1.desktop-browsers.create.$post": createTab,
    });

    await expect(
      run([ARTIFACT_URL, "--thread", "thr_1", "--host", "desk"]),
    ).rejects.toThrow("process.exit:1");
    expectError("Several bb desktop windows are connected");
    expect(createTab).not.toHaveBeenCalled();

    await run([
      ARTIFACT_URL,
      "--thread",
      "thr_1",
      "--host",
      "desk",
      "--instance",
      "win2",
    ]);
    expect(createTab).toHaveBeenCalledWith({
      json: expect.objectContaining({
        instanceId: "win2",
        generation: "gen-win2",
      }),
    });
  });

  it("names the hosts it could not query when no desktop window is found", async () => {
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [host("desk", "connected")]),
      "v1.desktop-browsers.instances.$post": vi.fn(async () => {
        throw new Error("desktop unavailable");
      }),
    });

    await expect(run([ARTIFACT_URL, "--thread", "thr_1"])).rejects.toThrow(
      "process.exit:1",
    );
    expectError("No connected bb desktop window found.");
    expectError("desk: desktop unavailable");
  });

  it("reports the error of an explicitly chosen host", async () => {
    const hosts = vi.fn();
    stubServerApi({
      "v1.hosts.$get": hosts,
      "v1.desktop-browsers.instances.$post": vi.fn(async () => {
        throw new Error("host needs an upgrade");
      }),
    });

    await expect(
      run([ARTIFACT_URL, "--thread", "thr_1", "--host", "desk"]),
    ).rejects.toThrow("process.exit:1");
    expectError("host needs an upgrade");
    expect(hosts).not.toHaveBeenCalled();
  });

  it("requires a thread outside a bb thread", async () => {
    vi.stubEnv("BB_THREAD_ID", "");
    const instances = vi.fn();
    stubServerApi({ "v1.desktop-browsers.instances.$post": instances });

    await expect(run([ARTIFACT_URL])).rejects.toThrow("process.exit:1");
    expectError("Missing thread for the artifact tab.");
    expect(instances).not.toHaveBeenCalled();
  });

  it("prints the created tab as JSON", async () => {
    const created = { tab: { tabId: "tab1", url: ARTIFACT_URL } };
    stubServerApi({
      "v1.desktop-browsers.instances.$post": vi.fn(async () => ({
        instances: [windowOn("desk", "win1")],
      })),
      "v1.desktop-browsers.create.$post": vi.fn(async () => created),
    });

    await run([ARTIFACT_URL, "--thread", "thr_1", "--host", "desk", "--json"]);

    expect(
      collectLogPayloads(vi.mocked(console.log)).map((line) =>
        JSON.parse(line),
      ),
    ).toEqual([created]);
  });
});
