import { describe, expect, it } from "vitest";
import {
  formatThreadBackdrop,
  formatThreadProviderCommands,
  formatThreadSessionOptions,
  parseSessionOptionAssignments,
  parseSpawnSessionOptions,
} from "./session-state.js";

describe("thread session state output", () => {
  it("lists agent commands with their argument hint and description", () => {
    expect(
      formatThreadProviderCommands([
        {
          name: "web",
          source: "command",
          origin: "builtin",
          description: "Search the web",
          argumentHint: "query",
        },
        {
          name: "compact",
          source: "command",
          origin: "builtin",
          description: null,
          argumentHint: null,
        },
      ]),
    ).toEqual(["/web <query>  Search the web", "/compact"]);
    expect(formatThreadProviderCommands(null)).toEqual([
      "The agent has not advertised any commands for this thread.",
    ]);
  });

  it("describes the thread's backdrop, or says none is set", () => {
    expect(
      formatThreadBackdrop({
        source: "night-sky",
        scene: "stars",
        colorScheme: "dark",
        glass: { blur: 12, opacity: 0.55, tint: "#0b1026" },
        tree: { type: "Box", props: {}, children: [] },
        ground: null,
      }),
    ).toEqual([
      "Set by: night-sky",
      "Scene: stars",
      "Ground: none",
      "Color scheme: dark",
      "Glass: blur 12px, opacity 0.55, tint #0b1026",
      "Drawing: provided",
    ]);
    expect(
      formatThreadBackdrop({
        source: "ground-probe",
        scene: null,
        colorScheme: null,
        glass: null,
        tree: null,
        ground: {
          type: "gradient",
          stops: [
            { at: null, color: "#0b1026" },
            { at: 0.7, color: "#3b3f7a" },
          ],
          angle: 180,
          shape: "linear",
          size: null,
          repeat: false,
        },
      }),
    ).toEqual([
      "Set by: ground-probe",
      "Scene: none",
      "Ground: linear gradient (2 stops)",
      "Color scheme: unchanged",
      "Glass: none",
      "Drawing: none",
    ]);
    expect(
      formatThreadBackdrop({
        source: "tiles",
        scene: null,
        colorScheme: "light",
        glass: null,
        tree: null,
        ground: {
          type: "image",
          mime: "image/png",
          dataBase64: "iVBORw==",
          width: 16,
          height: 16,
          size: [32, 32],
          repeat: true,
        },
      }).slice(2, 3),
    ).toEqual(["Ground: image (image/png, 16x16, tiled)"]);
    expect(formatThreadBackdrop(null)).toEqual([
      "No backdrop is set for this thread.",
    ]);
  });

  it("lists session options, marking the current value of a select", () => {
    expect(
      formatThreadSessionOptions([
        {
          type: "select",
          id: "mode",
          label: "Mode",
          description: null,
          category: "mode",
          value: "plan",
          pendingValue: "build",
          values: [
            { id: "plan", label: "Plan", description: null, group: null },
            { id: "build", label: "build", description: null, group: null },
          ],
        },
        {
          type: "boolean",
          id: "brave",
          label: "Brave mode",
          description: null,
          category: null,
          value: true,
          pendingValue: null,
        },
      ]),
    ).toEqual([
      "mode (Mode): plan -> build on the next turn",
      "  * plan  Plan",
      "    build",
      "brave (Brave mode): true",
    ]);
    expect(formatThreadSessionOptions([])).toEqual([
      "The agent has not reported any session options for this thread.",
    ]);
  });

  it("turns --set and --clear into a patch, reading true and false for a boolean option", () => {
    const options = [
      {
        type: "boolean" as const,
        id: "web",
        label: "Web search",
        description: null,
        category: null,
        value: false,
        pendingValue: null,
      },
    ];
    expect(
      parseSessionOptionAssignments({
        options,
        set: ["web=true", "mode=plan=strict"],
        clear: ["brave"],
      }),
    ).toEqual({ web: true, mode: "plan=strict", brave: null });
    expect(() =>
      parseSessionOptionAssignments({ options, set: ["web=yes"], clear: [] }),
    ).toThrow("takes true or false");
    expect(() =>
      parseSessionOptionAssignments({ options, set: ["=plan"], clear: [] }),
    ).toThrow("Expected <option-id>=<value>");
    expect(() =>
      parseSessionOptionAssignments({
        options,
        set: ["web=true"],
        clear: ["web"],
      }),
    ).toThrow("cannot be both set and cleared");
  });

  it("turns spawn --option assignments into choices, reading true and false as on and off", () => {
    expect(
      parseSpawnSessionOptions(["daybreak=true", "web=false", "mode=plan=x"]),
    ).toEqual({ daybreak: true, web: false, mode: "plan=x" });
    expect(parseSpawnSessionOptions([])).toEqual({});
    expect(() => parseSpawnSessionOptions(["daybreak"])).toThrow(
      "Expected <option-id>=<value>",
    );
    expect(() => parseSpawnSessionOptions(["mode="])).toThrow(
      "Expected <option-id>=<value>",
    );
  });
});
