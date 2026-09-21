import { randomBytes } from "node:crypto";
import {
  chmod,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import {
  workbenchHostContract,
  type AgentModelError,
  type AgentModelResult,
  type AgentRole,
  type RoutingFileResult,
} from "./contract.js";
import {
  readFrontmatterKey,
  readFrontmatterModel,
  replaceFrontmatterModel,
  upsertFrontmatterKey,
} from "./frontmatter.js";

const AGENTS_DIR = ".claude/agents";
const SPECS_DIR = ".claude/specs";
const ROUTING_FILE = ".claude/ROUTING.md";

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

function tempFilePath(filePath: string): string {
  return `${filePath}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
}

function agentModelResult(content: string): AgentModelResult {
  const model = readFrontmatterModel(content);
  if (!model.ok) return model;
  const effort = readFrontmatterKey(content, "effort");
  return {
    ok: true,
    model: model.model,
    effort: effort.ok ? effort.value : null,
  };
}

export function createWorkbenchHostEntry(
  deps: {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    readdir: typeof readdir;
    rename: typeof rename;
    stat: typeof stat;
    chmod: typeof chmod;
    unlink: typeof unlink;
  } = {
    readFile,
    writeFile,
    readdir,
    rename,
    stat,
    chmod,
    unlink,
  },
) {
  async function rewriteAgentFile(
    role: AgentRole,
    transform: (
      content: string,
    ) => { ok: true; content: string } | { ok: false; error: AgentModelError },
  ): Promise<AgentModelResult> {
    const filePath = agentFilePath(role);
    let content: string;
    let mode: number;
    try {
      content = await deps.readFile(filePath, "utf8");
      mode = (await deps.stat(filePath)).mode;
    } catch (error) {
      if (isEnoent(error)) {
        return { ok: false, error: "missing_file" };
      }
      throw error;
    }
    const result = transform(content);
    if (!result.ok) return result;
    const tempPath = tempFilePath(filePath);
    try {
      await deps.writeFile(tempPath, result.content, "utf8");
      await deps.chmod(tempPath, mode);
      await deps.rename(tempPath, filePath);
    } catch (error) {
      await deps.unlink(tempPath).catch(() => undefined);
      throw error;
    }
    return agentModelResult(result.content);
  }

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
        return agentModelResult(content);
      },
      writeAgentModel({ role, model }): Promise<AgentModelResult> {
        return rewriteAgentFile(role, (content) =>
          replaceFrontmatterModel(content, model),
        );
      },
      writeAgentEffort({ role, effort }): Promise<AgentModelResult> {
        return rewriteAgentFile(role, (content) => {
          const current = readFrontmatterModel(content);
          if (!current.ok) return current;
          return upsertFrontmatterKey(content, "effort", effort);
        });
      },
      async readRouting(): Promise<RoutingFileResult> {
        try {
          const markdown = await deps.readFile(
            path.join(homedir(), ROUTING_FILE),
            "utf8",
          );
          return { ok: true, markdown };
        } catch (error) {
          if (isEnoent(error)) return { ok: false, error: "missing_file" };
          throw error;
        }
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
