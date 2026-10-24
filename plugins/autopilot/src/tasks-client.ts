/**
 * Thin typed client for the Tasks plugin's RPC methods autopilot needs.
 * Output schemas are loose on purpose: we read a few fields and tolerate the
 * rest, so additive changes in the Tasks plugin do not break autopilot.
 */
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const TASKS_PLUGIN_ID = "tasks";

const taskSchema = z.looseObject({
  id: z.string(),
  projectId: z.string(),
  key: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  priority: z.string(),
  position: z.number(),
  labelIds: z.array(z.string()),
});
export type TaskRecord = z.infer<typeof taskSchema>;

const projectSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  linkedBbProjectId: z.string().nullable().optional(),
});
export type TaskProject = z.infer<typeof projectSchema>;

const mutationSchema = z.union([
  z.looseObject({ ok: z.literal(true), task: taskSchema }),
  z.looseObject({
    ok: z.literal(false),
    error: z.looseObject({ code: z.string(), message: z.string().optional() }),
  }),
]);

function unwrap(result: z.infer<typeof mutationSchema>): TaskRecord {
  if (result.ok) return result.task;
  throw new Error(
    `Tasks: ${result.error.code}${result.error.message ? ` — ${result.error.message}` : ""}`,
  );
}

const labelSchema = z.looseObject({ id: z.string(), name: z.string() });
const presetSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  providerId: z.string(),
  modelId: z.string(),
  reasoningLevel: z.string(),
  permissionMode: z.string(),
  environmentKind: z.string(),
});
export type TaskPreset = z.infer<typeof presetSchema>;

export class TasksClient {
  constructor(private readonly bb: BbPluginApi) {}

  private call<T>(method: string, input: unknown, schema: z.ZodType<T>): Promise<T> {
    return this.bb.sdk.plugins.callRpc({
      pluginId: TASKS_PLUGIN_ID,
      method,
      input: input as never,
      outputSchema: schema,
      signal: AbortSignal.timeout(30_000),
    });
  }

  async listProjects(): Promise<TaskProject[]> {
    const out = await this.call(
      "listProjects",
      {},
      z.looseObject({ projects: z.array(projectSchema) }),
    );
    return out.projects;
  }

  async createProject(input: {
    name: string;
    prefix: string;
    color: string;
    linkedBbProjectId: string;
  }): Promise<TaskProject> {
    const out = await this.call(
      "createProject",
      input,
      z.looseObject({ project: projectSchema }),
    );
    return out.project;
  }

  async listLabels(projectId: string): Promise<{ id: string; name: string }[]> {
    const out = await this.call(
      "listLabels",
      { projectId },
      z.looseObject({ labels: z.array(labelSchema) }),
    );
    return out.labels;
  }

  async createLabel(projectId: string, name: string, color: string) {
    const out = await this.call(
      "createLabel",
      { projectId, name, color },
      z.looseObject({ label: labelSchema }),
    );
    return out.label;
  }

  async listTasks(input: {
    projectId: string;
    statuses?: string[];
    labelIds?: string[];
  }): Promise<TaskRecord[]> {
    const tasks: TaskRecord[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const out = await this.call(
        "listTasks",
        { ...input, limit: 100, ...(cursor ? { cursor } : {}) },
        z.looseObject({
          tasks: z.array(taskSchema),
          nextCursor: z.string().nullable(),
        }),
      );
      tasks.push(...out.tasks);
      if (out.nextCursor === null) break;
      cursor = out.nextCursor;
    }
    return tasks;
  }

  async getTask(taskId: string): Promise<TaskRecord | null> {
    const out = await this.call(
      "getTask",
      { taskId },
      z.looseObject({ task: taskSchema.nullable() }),
    );
    return out.task;
  }

  async updateStatus(taskId: string, status: string): Promise<void> {
    unwrap(
      await this.call(
        "updateTask",
        { taskId, status, authorName: "Автопилот" },
        mutationSchema,
      ),
    );
  }

  async comment(taskId: string, body: string): Promise<void> {
    await this.call(
      "createComment",
      { taskId, body, notify: false },
      z.unknown(),
    );
  }

  async createTask(input: {
    projectId: string;
    title: string;
    description: string;
    labelIds: string[];
    priority?: string;
  }): Promise<TaskRecord> {
    return unwrap(
      await this.call(
        "createTask",
        { status: "todo", priority: "medium", ...input },
        mutationSchema,
      ),
    );
  }

  async listPresets(): Promise<TaskPreset[]> {
    const out = await this.call(
      "listPresets",
      null,
      z.looseObject({ presets: z.array(presetSchema) }),
    );
    return out.presets;
  }

  async createPreset(input: {
    name: string;
    providerId: string;
    modelId: string;
    reasoningLevel: string;
    permissionMode: string;
    environmentKind: string;
    instructions: string;
  }): Promise<TaskPreset> {
    const out = await this.call(
      "createPreset",
      input,
      z.looseObject({ preset: presetSchema }),
    );
    return out.preset;
  }

  async delegate(input: {
    taskId: string;
    presetId: string;
    extraInstructions: string;
  }): Promise<string> {
    const out = await this.call(
      "delegate",
      input,
      z.looseObject({ threadId: z.string() }),
    );
    return out.threadId;
  }
}
