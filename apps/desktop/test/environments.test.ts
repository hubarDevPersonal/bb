import { describe, expect, it } from "vitest";
import {
  ENVIRONMENTS_TEMPLATE,
  environmentServerUrl,
  findEnvironmentForServerUrl,
  findLocalEnvironment,
  loadEnvironments,
  parseEnvironmentsFile,
} from "../src/environments.js";

function parseLoaded(value: unknown) {
  const result = parseEnvironmentsFile(JSON.stringify(value));
  if (result.kind !== "loaded") {
    throw new Error(`expected loaded, got ${JSON.stringify(result)}`);
  }
  return result.value;
}

describe("parseEnvironmentsFile", () => {
  it("fills ssh defaults, colors, and the local kind", () => {
    const value = parseLoaded({
      environments: [
        { id: "mac", name: "This Mac" },
        {
          id: "vps",
          name: "VPS",
          ssh: { destination: "artem@host", localPort: 38901 },
        },
      ],
    });

    expect(value.shared).toEqual({
      rulesSource: null,
      rulesTarget: "~/Dev/claude-agent",
      rulesInstall: "sh install-agent.sh",
    });
    expect(value.environments[0]).toMatchObject({
      id: "mac",
      kind: "local",
      ssh: null,
      color: "blue",
      actions: [],
    });
    expect(value.environments[1]).toMatchObject({
      id: "vps",
      kind: "ssh",
      color: "green",
      ssh: {
        destination: "artem@host",
        remotePort: 38886,
        localPort: 38901,
        startCommand: "systemctl --user start bb.service",
      },
    });
    expect(environmentServerUrl(value.environments[1]!)).toBe(
      "http://127.0.0.1:38901",
    );
    expect(environmentServerUrl(value.environments[0]!)).toBeNull();
  });

  it("accepts the shipped template", () => {
    expect(parseLoaded(ENVIRONMENTS_TEMPLATE).environments).toHaveLength(2);
  });

  it("rejects duplicate ids, shared local ports and a second local environment", () => {
    const result = parseEnvironmentsFile(
      JSON.stringify({
        environments: [
          { id: "a", name: "A" },
          { id: "a", name: "B" },
          {
            id: "c",
            name: "C",
            ssh: { destination: "c", localPort: 40000 },
          },
          {
            id: "d",
            name: "D",
            ssh: { destination: "d", localPort: 40000 },
          },
        ],
      }),
    );
    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.message).toContain('duplicate environment id "a"');
    expect(result.message).toContain("local port 40000 is used twice");
    expect(result.message).toContain("only one environment may omit ssh");
  });

  it("reports malformed JSON and unknown keys instead of throwing", () => {
    expect(parseEnvironmentsFile("{").kind).toBe("invalid");
    const unknownKey = parseEnvironmentsFile(
      JSON.stringify({ environments: [{ id: "a", name: "A", host: "x" }] }),
    );
    expect(unknownKey.kind).toBe("invalid");
  });

  it("maps server URLs back to environments", () => {
    const value = parseLoaded({
      environments: [
        { id: "mac", name: "This Mac" },
        {
          id: "vps",
          name: "VPS",
          ssh: { destination: "artem@host", localPort: 38901 },
        },
      ],
    });
    expect(
      findEnvironmentForServerUrl(value.environments, "http://127.0.0.1:38901")
        ?.id,
    ).toBe("vps");
    expect(
      findEnvironmentForServerUrl(value.environments, "http://127.0.0.1:1"),
    ).toBeNull();
    expect(findLocalEnvironment(value.environments)?.id).toBe("mac");
  });
});

describe("loadEnvironments", () => {
  it("returns missing when the file does not exist", async () => {
    const result = await loadEnvironments("/nope/environments.json", {
      readFile: async () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
    });
    expect(result).toEqual({ kind: "missing" });
  });
});
