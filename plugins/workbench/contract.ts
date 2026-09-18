import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const AGENT_ROLES = ["scout", "implementer", "reviewer"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

const agentRoleSchema = z.enum(AGENT_ROLES);

export const AGENT_MODEL_PATTERN = /^[A-Za-z0-9._:/[\]-]+$/;
export const AGENT_MODEL_MAX_LENGTH = 200;
export const agentModelValueSchema = z
  .string()
  .min(1)
  .max(AGENT_MODEL_MAX_LENGTH)
  .regex(AGENT_MODEL_PATTERN);

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
      .object({ role: agentRoleSchema, model: agentModelValueSchema })
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
