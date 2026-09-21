import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { AGENT_EFFORT_LEVELS, AGENT_ROLES } from "./routing.js";

export {
  AGENT_EFFORT_LEVELS,
  AGENT_ROLES,
  type AgentEffortLevel,
  type AgentRole,
} from "./routing.js";

const agentRoleSchema = z.enum(AGENT_ROLES);
export const agentEffortSchema = z.enum(AGENT_EFFORT_LEVELS);

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
  | { ok: true; model: string; effort: string | null }
  | { ok: false; error: AgentModelError };

const readAgentModelResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      model: z.string(),
      effort: z.string().nullable(),
    })
    .strict(),
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

export type RoutingFileResult =
  | { ok: true; markdown: string }
  | { ok: false; error: "missing_file" };

const readRoutingResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), markdown: z.string() }).strict(),
  z.object({ ok: z.literal(false), error: z.literal("missing_file") }).strict(),
]) satisfies z.ZodType<RoutingFileResult>;

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
  writeAgentEffort: {
    input: z
      .object({ role: agentRoleSchema, effort: agentEffortSchema })
      .strict(),
    output: writeAgentModelResultSchema,
  },
  readRouting: {
    input: z.null(),
    output: readRoutingResultSchema,
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
