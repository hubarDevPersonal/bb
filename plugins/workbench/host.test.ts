import { homedir } from "node:os";
import path from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it, vi } from "vitest";
import { createWorkbenchHostEntry } from "./host.js";
import {
  readFrontmatterModel,
  replaceFrontmatterModel,
} from "./frontmatter.js";

const agentPath = (role: string) =>
  path.join(homedir(), ".claude/agents", `${role}.md`);

describe("frontmatter model parse/replace", () => {
  it("reads and replaces the model line", () => {
    const content = "---\nname: scout\nmodel: haiku\n---\nBody text.\n";
    expect(readFrontmatterModel(content)).toEqual({ ok: true, model: "haiku" });
    const replaced = replaceFrontmatterModel(content, "sonnet");
    expect(replaced).toEqual({
      ok: true,
      content: "---\nname: scout\nmodel: sonnet\n---\nBody text.\n",
    });
  });

  it("preserves other keys, body, and CRLF line endings", () => {
    const content =
      "---\r\nname: reviewer\r\nmodel: opus\r\ntools: read, write\r\n---\r\nLine one.\r\nLine two.\r\n";
    const replaced = replaceFrontmatterModel(content, "sonnet");
    expect(replaced).toEqual({
      ok: true,
      content:
        "---\r\nname: reviewer\r\nmodel: sonnet\r\ntools: read, write\r\n---\r\nLine one.\r\nLine two.\r\n",
    });
  });

  it("errors when the frontmatter block is missing", () => {
    const content = "No frontmatter here.\n";
    expect(readFrontmatterModel(content)).toEqual({
      ok: false,
      error: "missing_frontmatter",
    });
    expect(replaceFrontmatterModel(content, "sonnet")).toEqual({
      ok: false,
      error: "missing_frontmatter",
    });
  });

  it("errors when the frontmatter has no model key", () => {
    const content = "---\nname: scout\n---\nBody.\n";
    expect(readFrontmatterModel(content)).toEqual({
      ok: false,
      error: "missing_model_key",
    });
    expect(replaceFrontmatterModel(content, "sonnet")).toEqual({
      ok: false,
      error: "missing_model_key",
    });
  });

  it("errors when the closing frontmatter delimiter is missing", () => {
    const content = "---\nname: scout\nmodel: haiku\nBody.\n";
    expect(readFrontmatterModel(content)).toEqual({
      ok: false,
      error: "missing_frontmatter",
    });
  });
});

describe("workbench host entry", () => {
  function harnessWithFiles(files: Record<string, string>) {
    const store = new Map(Object.entries(files));
    const readFile = vi.fn(async (filePath: string) => {
      const content = store.get(filePath);
      if (content === undefined) {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      }
      return content;
    });
    const writeFile = vi.fn(async (filePath: string, content: string) => {
      store.set(filePath, content);
    });
    const readdir = vi.fn();
    return {
      store,
      readFile,
      writeFile,
      readdir,
      harness: experimental_createHostEntryHarness(
        createWorkbenchHostEntry({
          readFile: readFile as never,
          writeFile: writeFile as never,
          readdir: readdir as never,
        }),
      ),
    };
  }

  it("reads the model from an existing agent file", async () => {
    const { harness } = harnessWithFiles({
      [agentPath("scout")]: "---\nmodel: haiku\n---\n",
    });
    await expect(
      harness.experimental_call("readAgentModel", { role: "scout" }),
    ).resolves.toEqual({ ok: true, model: "haiku" });
    await harness.experimental_dispose();
  });

  it("reports missing_file when the agent file does not exist", async () => {
    const { harness } = harnessWithFiles({});
    await expect(
      harness.experimental_call("readAgentModel", { role: "scout" }),
    ).resolves.toEqual({ ok: false, error: "missing_file" });
    await expect(
      harness.experimental_call("writeAgentModel", {
        role: "scout",
        model: "sonnet",
      }),
    ).resolves.toEqual({ ok: false, error: "missing_file" });
    await harness.experimental_dispose();
  });

  it("writes the model back and never creates the file", async () => {
    const { harness, writeFile, store } = harnessWithFiles({
      [agentPath("implementer")]: "---\nmodel: haiku\n---\nBody.\n",
    });
    await expect(
      harness.experimental_call("writeAgentModel", {
        role: "implementer",
        model: "sonnet",
      }),
    ).resolves.toEqual({ ok: true, model: "sonnet" });
    expect(writeFile).toHaveBeenCalledOnce();
    expect(store.get(agentPath("implementer"))).toBe(
      "---\nmodel: sonnet\n---\nBody.\n",
    );
    await harness.experimental_dispose();
  });

  it("lists spec files sorted and filtered to markdown", async () => {
    const { harness, readdir } = harnessWithFiles({});
    readdir.mockResolvedValue([
      { name: "b-spec.md", isFile: () => true },
      { name: "a-spec.md", isFile: () => true },
      { name: "notes.txt", isFile: () => true },
      { name: "sub", isFile: () => false },
    ]);
    const result = await harness.experimental_call("listSpecFiles", null);
    expect(result.files.map((file) => file.name)).toEqual([
      "a-spec.md",
      "b-spec.md",
    ]);
    await harness.experimental_dispose();
  });

  it("returns an empty list when the specs directory does not exist", async () => {
    const { harness, readdir } = harnessWithFiles({});
    readdir.mockRejectedValue(
      Object.assign(new Error("nope"), { code: "ENOENT" }),
    );
    await expect(
      harness.experimental_call("listSpecFiles", null),
    ).resolves.toEqual({ files: [] });
    await harness.experimental_dispose();
  });
});
