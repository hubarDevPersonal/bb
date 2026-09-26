import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export const ENVIRONMENTS_FILE_NAME = "environments.json";
export const MAX_ENVIRONMENTS = 9;

export const ENVIRONMENT_COLORS = [
  "blue",
  "green",
  "orange",
  "purple",
  "yellow",
  "pink",
] as const;
export type EnvironmentColor = (typeof ENVIRONMENT_COLORS)[number];

const DEFAULT_REMOTE_BB_PORT = 38_886;
const DEFAULT_START_COMMAND = "systemctl --user start bb.service";
const DEFAULT_RULES_TARGET = "~/Dev/claude-agent";
const DEFAULT_RULES_INSTALL = "sh install-agent.sh";
const DEFAULT_UPDATE_COMMAND =
  'export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH" && cd ~/Dev/bb && git pull --ff-only && pnpm install --frozen-lockfile && pnpm build && systemctl --user restart bb.service';

const portSchema = z.number().int().min(1).max(65_535);
const environmentIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/u, "use lowercase letters, digits and -");

const environmentActionSchema = z
  .object({
    id: environmentIdSchema,
    label: z.string().min(1).max(60),
    command: z.string().min(1),
  })
  .strict();
export type EnvironmentAction = z.infer<typeof environmentActionSchema>;

const sshSettingsSchema = z
  .object({
    destination: z.string().min(1),
    identityFile: z.string().min(1).optional(),
    port: portSchema.optional(),
    remotePort: portSchema.default(DEFAULT_REMOTE_BB_PORT),
    localPort: portSchema,
    startCommand: z.string().min(1).nullable().default(DEFAULT_START_COMMAND),
    updateCommand: z.string().min(1).nullable().default(DEFAULT_UPDATE_COMMAND),
  })
  .strict();
export type EnvironmentSshSettings = z.infer<typeof sshSettingsSchema>;

const environmentSchema = z
  .object({
    id: environmentIdSchema,
    name: z.string().min(1).max(40),
    color: z.enum(ENVIRONMENT_COLORS).optional(),
    ssh: sshSettingsSchema.optional(),
    syncRules: z.boolean().default(true),
    actions: z.array(environmentActionSchema).default([]),
  })
  .strict();

const sharedSettingsSchema = z
  .object({
    rulesSource: z.string().min(1).nullable().default(null),
    rulesTarget: z.string().min(1).default(DEFAULT_RULES_TARGET),
    rulesInstall: z.string().min(1).default(DEFAULT_RULES_INSTALL),
  })
  .strict();
export type EnvironmentSharedSettings = z.infer<typeof sharedSettingsSchema>;

const environmentsFileSchema = z
  .object({
    shared: sharedSettingsSchema.default({
      rulesSource: null,
      rulesTarget: DEFAULT_RULES_TARGET,
      rulesInstall: DEFAULT_RULES_INSTALL,
    }),
    environments: z.array(environmentSchema).max(MAX_ENVIRONMENTS),
  })
  .strict()
  .superRefine((file, context) => {
    const ids = new Set<string>();
    const localPorts = new Set<number>();
    let localCount = 0;
    file.environments.forEach((environment, index) => {
      if (ids.has(environment.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate environment id "${environment.id}"`,
          path: ["environments", index, "id"],
        });
      }
      ids.add(environment.id);
      if (environment.ssh === undefined) {
        localCount += 1;
        return;
      }
      if (localPorts.has(environment.ssh.localPort)) {
        context.addIssue({
          code: "custom",
          message: `local port ${environment.ssh.localPort} is used twice`,
          path: ["environments", index, "ssh", "localPort"],
        });
      }
      localPorts.add(environment.ssh.localPort);
    });
    if (localCount > 1) {
      context.addIssue({
        code: "custom",
        message: "only one environment may omit ssh (this computer)",
        path: ["environments"],
      });
    }
  });

export interface DesktopEnvironment {
  id: string;
  name: string;
  color: EnvironmentColor;
  kind: "local" | "ssh";
  ssh: EnvironmentSshSettings | null;
  syncRules: boolean;
  actions: EnvironmentAction[];
}

export interface DesktopEnvironments {
  shared: EnvironmentSharedSettings;
  environments: DesktopEnvironment[];
}

export type LoadEnvironmentsResult =
  | { kind: "loaded"; value: DesktopEnvironments }
  | { kind: "missing" }
  | { kind: "invalid"; message: string };

export interface EnvironmentsFs {
  readFile(path: string, encoding: "utf8"): Promise<string>;
}

const defaultFs: EnvironmentsFs = { readFile };

export function resolveEnvironmentsPath(userDataPath: string): string {
  return join(userDataPath, ENVIRONMENTS_FILE_NAME);
}

export function environmentServerUrl(
  environment: Pick<DesktopEnvironment, "ssh">,
): string | null {
  return environment.ssh === null
    ? null
    : `http://127.0.0.1:${environment.ssh.localPort}`;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export function parseEnvironmentsFile(raw: string): LoadEnvironmentsResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return {
      kind: "invalid",
      message: `not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    };
  }
  const parsed = environmentsFileSchema.safeParse(json);
  if (!parsed.success) {
    return { kind: "invalid", message: formatIssues(parsed.error) };
  }
  return {
    kind: "loaded",
    value: {
      shared: parsed.data.shared,
      environments: parsed.data.environments.map((environment, index) => ({
        id: environment.id,
        name: environment.name,
        color:
          environment.color ??
          ENVIRONMENT_COLORS[index % ENVIRONMENT_COLORS.length]!,
        kind: environment.ssh === undefined ? "local" : "ssh",
        ssh: environment.ssh ?? null,
        syncRules: environment.syncRules,
        actions: environment.actions,
      })),
    },
  };
}

export async function loadEnvironments(
  path: string,
  fs: EnvironmentsFs = defaultFs,
): Promise<LoadEnvironmentsResult> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf8");
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { kind: "missing" };
    }
    return {
      kind: "invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  return parseEnvironmentsFile(raw);
}

export const ENVIRONMENTS_TEMPLATE = {
  shared: {
    rulesSource: "~/Dev/claude-dotfiles/agent",
    rulesTarget: DEFAULT_RULES_TARGET,
    rulesInstall: DEFAULT_RULES_INSTALL,
  },
  environments: [
    { id: "mac", name: "This Mac", color: "blue" },
    {
      id: "vps",
      name: "VPS",
      color: "green",
      ssh: {
        destination: "user@203.0.113.10",
        identityFile: "~/.ssh/id_ed25519",
        remotePort: DEFAULT_REMOTE_BB_PORT,
        localPort: 38_901,
      },
    },
  ],
};

export async function writeEnvironmentsTemplate(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(ENVIRONMENTS_TEMPLATE, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export function findEnvironmentForServerUrl(
  environments: readonly DesktopEnvironment[],
  serverUrl: string,
): DesktopEnvironment | null {
  return (
    environments.find(
      (environment) => environmentServerUrl(environment) === serverUrl,
    ) ?? null
  );
}

export function findLocalEnvironment(
  environments: readonly DesktopEnvironment[],
): DesktopEnvironment | null {
  return (
    environments.find((environment) => environment.kind === "local") ?? null
  );
}
