import {
  chmod as chmodReal,
  mkdir,
  mkdtemp,
  readdir as readdirReal,
  readFile as readFileReal,
  rm,
  stat as statReal,
  writeFile as writeFileReal,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import { describe, expect, it, vi } from "vitest";
import { createWorkbenchHostEntry } from "./host.js";
import {
  readFrontmatterKey,
  readFrontmatterModel,
  replaceFrontmatterModel,
  upsertFrontmatterKey,
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

  it("never matches an indented model key inside a block scalar", () => {
    const content =
      "---\nname: scout\ndescription: |\n  model: x\n---\nBody.\n";
    expect(readFrontmatterModel(content)).toEqual({
      ok: false,
      error: "missing_model_key",
    });
    expect(replaceFrontmatterModel(content, "sonnet")).toEqual({
      ok: false,
      error: "missing_model_key",
    });
  });

  it("rebuilds an empty value as valid YAML instead of concatenating", () => {
    const content = "---\nmodel:\n---\n";
    expect(readFrontmatterModel(content)).toEqual({ ok: true, model: "" });
    expect(replaceFrontmatterModel(content, "opus")).toEqual({
      ok: true,
      content: "---\nmodel: opus\n---\n",
    });
  });

  it("strips matching quotes and a trailing comment on read", () => {
    expect(readFrontmatterModel("---\nmodel: 'opus'\n---\n")).toEqual({
      ok: true,
      model: "opus",
    });
    expect(readFrontmatterModel('---\nmodel: "opus"\n---\n')).toEqual({
      ok: true,
      model: "opus",
    });
    expect(readFrontmatterModel("---\nmodel: opus # fast\n---\n")).toEqual({
      ok: true,
      model: "opus",
    });
  });

  it("preserves a missing trailing newline on the last frontmatter line", () => {
    const content = "---\nmodel: haiku\n---";
    const replaced = replaceFrontmatterModel(content, "sonnet");
    expect(replaced).toEqual({ ok: true, content: "---\nmodel: sonnet\n---" });
  });
});

describe("frontmatter effort read/upsert", () => {
  it("reads a missing effort as null and an existing one as its value", () => {
    expect(readFrontmatterKey("---\nmodel: opus\n---\n", "effort")).toEqual({
      ok: true,
      value: null,
    });
    expect(
      readFrontmatterKey("---\nmodel: opus\neffort: 'high'\n---\n", "effort"),
    ).toEqual({ ok: true, value: "high" });
  });

  it("inserts a missing effort right after the model line, byte-preserving the rest", () => {
    const content =
      "---\r\nname: scout\r\nmodel: sonnet\r\ntools: Read, Grep\r\n---\r\neffort: body\r\n";
    expect(upsertFrontmatterKey(content, "effort", "medium")).toEqual({
      ok: true,
      content:
        "---\r\nname: scout\r\nmodel: sonnet\r\neffort: medium\r\ntools: Read, Grep\r\n---\r\neffort: body\r\n",
    });
  });

  it("inserts before the closing delimiter when there is no model line", () => {
    expect(
      upsertFrontmatterKey("---\nname: scout\n---\nBody.\n", "effort", "low"),
    ).toEqual({
      ok: true,
      content: "---\nname: scout\neffort: low\n---\nBody.\n",
    });
  });

  it("replaces an existing effort in place", () => {
    expect(
      upsertFrontmatterKey(
        "---\neffort: low # fast\nmodel: opus\n---\n",
        "effort",
        "max",
      ),
    ).toEqual({ ok: true, content: "---\neffort: max\nmodel: opus\n---\n" });
  });

  it("never matches an indented effort key and errors without frontmatter", () => {
    expect(
      readFrontmatterKey(
        "---\ndescription: |\n  effort: high\nmodel: opus\n---\n",
        "effort",
      ),
    ).toEqual({ ok: true, value: null });
    expect(upsertFrontmatterKey("Body only.\n", "effort", "high")).toEqual({
      ok: false,
      error: "missing_frontmatter",
    });
  });
});

describe("workbench host entry", () => {
  function harnessWithFiles(files: Record<string, string>) {
    const store = new Map(Object.entries(files));
    const modes = new Map(Object.keys(files).map((key) => [key, 0o644]));
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
    const stat = vi.fn(async (filePath: string) => {
      const mode = modes.get(filePath);
      if (mode === undefined) {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      }
      return { mode } as { mode: number };
    });
    const chmod = vi.fn(async (filePath: string, mode: number) => {
      modes.set(filePath, mode);
    });
    const rename = vi.fn(async (from: string, to: string) => {
      const content = store.get(from);
      if (content === undefined) {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      }
      store.delete(from);
      store.set(to, content);
      const mode = modes.get(from);
      modes.delete(from);
      if (mode !== undefined) modes.set(to, mode);
    });
    const unlink = vi.fn(async (filePath: string) => {
      store.delete(filePath);
      modes.delete(filePath);
    });
    const readdir = vi.fn();
    return {
      store,
      modes,
      readFile,
      writeFile,
      stat,
      chmod,
      rename,
      unlink,
      readdir,
      harness: experimental_createHostEntryHarness(
        createWorkbenchHostEntry({
          readFile: readFile as never,
          writeFile: writeFile as never,
          readdir: readdir as never,
          stat: stat as never,
          chmod: chmod as never,
          rename: rename as never,
          unlink: unlink as never,
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
    ).resolves.toEqual({ ok: true, model: "haiku", effort: null });
    await harness.experimental_dispose();
  });

  it("reads ROUTING.md raw and reports missing_file when it is absent", async () => {
    const routingPath = path.join(homedir(), ".claude/ROUTING.md");
    const present = harnessWithFiles({ [routingPath]: "| **Scout** |\n" });
    await expect(
      present.harness.experimental_call("readRouting", null),
    ).resolves.toEqual({ ok: true, markdown: "| **Scout** |\n" });
    await present.harness.experimental_dispose();
    const absent = harnessWithFiles({});
    await expect(
      absent.harness.experimental_call("readRouting", null),
    ).resolves.toEqual({ ok: false, error: "missing_file" });
    await absent.harness.experimental_dispose();
  });

  it("writes an effort key atomically and refuses a file without a model key", async () => {
    const { harness, rename, store } = harnessWithFiles({
      [agentPath("scout")]: "---\nmodel: sonnet\ntools: Read\n---\nBody.\n",
      [agentPath("reviewer")]: "---\nname: reviewer\n---\nBody.\n",
    });
    await expect(
      harness.experimental_call("writeAgentEffort", {
        role: "scout",
        effort: "medium",
      }),
    ).resolves.toEqual({ ok: true, model: "sonnet", effort: "medium" });
    expect(rename).toHaveBeenCalledOnce();
    expect(store.get(agentPath("scout"))).toBe(
      "---\nmodel: sonnet\neffort: medium\ntools: Read\n---\nBody.\n",
    );
    await expect(
      harness.experimental_call("writeAgentEffort", {
        role: "reviewer",
        effort: "high",
      }),
    ).resolves.toEqual({ ok: false, error: "missing_model_key" });
    expect(store.get(agentPath("reviewer"))).toBe(
      "---\nname: reviewer\n---\nBody.\n",
    );
    await harness.experimental_dispose();
  });

  it("rejects an effort outside the supported levels at the contract", async () => {
    const { harness } = harnessWithFiles({
      [agentPath("scout")]: "---\nmodel: sonnet\n---\n",
    });
    await expect(
      harness.experimental_call("writeAgentEffort", {
        role: "scout",
        effort: "high\nevil: 1" as never,
      }),
    ).rejects.toThrow();
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
    const { harness, writeFile, rename, store } = harnessWithFiles({
      [agentPath("implementer")]: "---\nmodel: haiku\n---\nBody.\n",
    });
    await expect(
      harness.experimental_call("writeAgentModel", {
        role: "implementer",
        model: "sonnet",
      }),
    ).resolves.toEqual({ ok: true, model: "sonnet", effort: null });
    expect(writeFile).toHaveBeenCalledOnce();
    expect(rename).toHaveBeenCalledOnce();
    expect(store.get(agentPath("implementer"))).toBe(
      "---\nmodel: sonnet\n---\nBody.\n",
    );
    expect(store.size).toBe(1);
    await harness.experimental_dispose();
  });

  it("writes through a temp file in the same directory and preserves the original mode", async () => {
    const fakeHome = await mkdtemp(path.join(tmpdir(), "workbench-host-"));
    const agentsDir = path.join(fakeHome, ".claude", "agents");
    const filePath = path.join(agentsDir, "implementer.md");
    const previousHome = process.env.HOME;
    try {
      await mkdir(agentsDir, { recursive: true });
      await writeFileReal(filePath, "---\nmodel: haiku\n---\nBody.\n", "utf8");
      await chmodReal(filePath, 0o640);
      const originalMode = (await statReal(filePath)).mode;

      process.env.HOME = fakeHome;
      const harness = experimental_createHostEntryHarness(
        createWorkbenchHostEntry(),
      );
      await expect(
        harness.experimental_call("writeAgentModel", {
          role: "implementer",
          model: "sonnet",
        }),
      ).resolves.toEqual({ ok: true, model: "sonnet", effort: null });
      await harness.experimental_dispose();

      expect(await readFileReal(filePath, "utf8")).toBe(
        "---\nmodel: sonnet\n---\nBody.\n",
      );
      expect((await statReal(filePath)).mode).toBe(originalMode);
      expect(await readdirReal(agentsDir)).toEqual(["implementer.md"]);
    } finally {
      process.env.HOME = previousHome;
      await rm(fakeHome, { recursive: true, force: true });
    }
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
