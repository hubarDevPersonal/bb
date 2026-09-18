import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const AGENT_ROLES = ["scout", "implementer", "reviewer"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

const agentRoleSchema = z.enum(AGENT_ROLES);

export type AgentModelError =
  | "missing_file"
  | "missing_frontmatter"
  | "missing_model_key";

export type AgentModelResult =
  | { ok: true; model: string }
  | { ok: false; error: AgentModelError };

const readAgentModelResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), model: z.string() }).strict(),
  z
    .object({
      ok: z.literal(false),
      error: z.enum([
        "missing_file",
        "missing_frontmatter",
        "missing_model_key",
      ]),
    })
    .strict(),
]) satisfies z.ZodType<AgentModelResult>;

const writeAgentModelResultSchema = readAgentModelResultSchema;

export const workbenchHostContract = defineRpcContract({
  readAgentModel: {
    input: z.object({ role: agentRoleSchema }).strict(),
    output: readAgentModelResultSchema,
  },
  writeAgentModel: {
    input: z
      .object({ role: agentRoleSchema, model: z.string().min(1) })
      .strict(),
    output: writeAgentModelResultSchema,
  },
  listSpecFiles: {
    input: z.null(),
    output: z
      .object({
        files: z.array(
          z.object({ name: z.string(), path: z.string() }).strict(),
        ),
      })
      .strict(),
  },
});
