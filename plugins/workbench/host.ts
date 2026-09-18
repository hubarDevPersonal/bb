import { readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import {
  workbenchHostContract,
  type AgentModelResult,
  type AgentRole,
} from "./contract.js";
import {
  readFrontmatterModel,
  replaceFrontmatterModel,
} from "./frontmatter.js";

const AGENTS_DIR = ".claude/agents";
const SPECS_DIR = ".claude/specs";

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function agentFilePath(role: AgentRole): string {
  return path.join(homedir(), AGENTS_DIR, `${role}.md`);
}

export function createWorkbenchHostEntry(
  deps: {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    readdir: typeof readdir;
  } = {
    readFile,
    writeFile,
    readdir,
  },
) {
  return experimental_defineHostEntry({
    contract: workbenchHostContract,
    handlers: {
      async readAgentModel({ role }): Promise<AgentModelResult> {
        let content: string;
        try {
          content = await deps.readFile(agentFilePath(role), "utf8");
        } catch (error) {
          if (isEnoent(error)) {
            return { ok: false, error: "missing_file" };
          }
          throw error;
        }
        return readFrontmatterModel(content);
      },
      async writeAgentModel({ role, model }): Promise<AgentModelResult> {
        const filePath = agentFilePath(role);
        let content: string;
        try {
          content = await deps.readFile(filePath, "utf8");
        } catch (error) {
          if (isEnoent(error)) {
            return { ok: false, error: "missing_file" };
          }
          throw error;
        }
        const result = replaceFrontmatterModel(content, model);
        if (!result.ok) return result;
        await deps.writeFile(filePath, result.content, "utf8");
        return { ok: true, model };
      },
      async listSpecFiles() {
        let entries;
        try {
          entries = await deps.readdir(path.join(homedir(), SPECS_DIR), {
            withFileTypes: true,
          });
        } catch (error) {
          if (isEnoent(error)) return { files: [] };
          throw error;
        }
        const files = entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => ({
            name: entry.name,
            path: path.join(homedir(), SPECS_DIR, entry.name),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return { files };
      },
    },
  });
}

export default createWorkbenchHostEntry();
