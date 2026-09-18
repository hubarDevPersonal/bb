import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useBbNavigate,
  useComposerView,
  useRpc,
  type PluginNavPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Switch } from "@bb/shared-ui/switch";
import {
  DescriptionDialogView,
  type DescriptionDialogViewProps,
} from "./description-dialog.js";
import { GOAL_MAX_TASKS_DEFAULT, GoalDialogView } from "./goal-dialog.js";
import {
  ModelRoutingSectionView,
  type ModelOption,
  type RoutingRoleId,
  type RoutingRowView,
} from "./model-routing.js";
import type { workbenchRpcContract } from "./server.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ComposerActionButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6.5 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50"
    >
      <Icon name={icon} className="size-4" aria-hidden />
    </button>
  );
}

function useThreadId(): string | null {
  const view = useComposerView();
  return view.scope.kind === "thread" ? view.scope.threadId : null;
}

function SpecCheckAction() {
  const threadId = useThreadId();
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [busy, setBusy] = useState(false);
  if (threadId === null) return null;
  return (
    <ComposerActionButton
      icon="CircleCheck"
      label="Spec check"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void rpc
          .call("runSpecCheck", { threadId })
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    />
  );
}

function DescriptionAction({
  icon,
  label,
  title,
  description,
  placeholder,
  submitLabel,
  method,
}: {
  icon: IconName;
  label: string;
  title: string;
  description: string;
  placeholder: string;
  submitLabel: string;
  method: "runTask" | "runBugfix";
}) {
  const threadId = useThreadId();
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (threadId === null) return null;

  const submit = async () => {
    const description = value.trim();
    if (description.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await rpc.call(method, { threadId, description });
      setOpen(false);
      setValue("");
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const dialogProps: DescriptionDialogViewProps = {
    open,
    onOpenChange: (next) => {
      if (!submitting) setOpen(next);
    },
    title,
    description,
    placeholder,
    value,
    onValueChange: setValue,
    submitting,
    error,
    submitLabel,
    onSubmit: () => void submit(),
  };

  return (
    <>
      <ComposerActionButton
        icon={icon}
        label={label}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      />
      <DescriptionDialogView {...dialogProps} />
    </>
  );
}

function TaskAction() {
  return (
    <DescriptionAction
      icon="ListTodo"
      label="Task"
      title="New task"
      description="Describe the task; sends /task with your description."
      placeholder="Describe the task…"
      submitLabel="Send /task"
      method="runTask"
    />
  );
}

function BugfixAction() {
  return (
    <DescriptionAction
      icon="Bug"
      label="Bugfix"
      title="New bugfix"
      description="Describe the bug; sends /bugfix with your description."
      placeholder="Describe the bug…"
      submitLabel="Send /bugfix"
      method="runBugfix"
    />
  );
}

function GoalAction() {
  const threadId = useThreadId();
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [maxTasks, setMaxTasks] = useState(GOAL_MAX_TASKS_DEFAULT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (threadId === null) return null;

  const submit = async () => {
    const trimmedGoal = goal.trim();
    if (trimmedGoal.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await rpc.call("runGoal", { threadId, goal: trimmedGoal, maxTasks });
      setOpen(false);
      setGoal("");
      setMaxTasks(GOAL_MAX_TASKS_DEFAULT);
    } catch (submitError) {
      setError(errorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <ComposerActionButton
        icon="Target"
        label="Goal"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      />
      <GoalDialogView
        open={open}
        onOpenChange={(next) => {
          if (!submitting) setOpen(next);
        }}
        goal={goal}
        onGoalChange={setGoal}
        maxTasks={maxTasks}
        onMaxTasksChange={setMaxTasks}
        submitting={submitting}
        error={error}
        onSubmit={() => void submit()}
      />
    </>
  );
}

function SpecInitBanner() {
  const view = useComposerView();
  if (view.scope.kind !== "thread") return null;
  return (
    <SpecInitBannerForThread
      key={view.scope.threadId}
      threadId={view.scope.threadId}
    />
  );
}

function SpecInitBannerForThread({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [show, setShow] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let active = true;
    void rpc
      .call("specInitBannerStatus", { threadId })
      .then((result) => {
        if (active) setShow(result.show);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [rpc, threadId]);

  if (!show) return null;

  return (
    <section
      aria-label="No project spec yet"
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          No project spec yet
        </p>
        <p className="text-xs text-subtle-foreground">
          .claude/specs/PROJECT.md is missing
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        disabled={running}
        onClick={() => {
          setRunning(true);
          void rpc
            .call("runSpecInit", { threadId })
            .then(() => setShow(false))
            .catch(() => undefined)
            .finally(() => setRunning(false));
        }}
      >
        {running ? "Starting…" : "Run spec init"}
      </Button>
    </section>
  );
}

function OrchestratedModeRow() {
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void rpc
      .call("getOrchestratedMode")
      .then((result) => {
        if (active) setEnabled(result.enabled);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [rpc]);

  return (
    <div className="flex items-start justify-between gap-3 rounded-md bg-surface-raised px-2 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">Orchestrated mode</p>
        <p className="text-xs text-subtle-foreground">
          Delegate reconnaissance, implementation, and review to subagents.
          Applies to new sessions.
        </p>
      </div>
      <Switch
        checked={enabled ?? false}
        disabled={enabled === null || saving}
        aria-label="Orchestrated mode"
        onCheckedChange={(next) => {
          setSaving(true);
          setEnabled(next);
          void rpc
            .call("setOrchestratedMode", { enabled: next })
            .catch(() =>
              setEnabled((current) => (current === next ? !next : current)),
            )
            .finally(() => setSaving(false));
        }}
      />
    </div>
  );
}

interface SpecFileRow {
  name: string;
  path: string;
  hostId: string;
}

interface ProjectSpecFileRow extends SpecFileRow {
  projectId: string;
  projectName: string;
}

function SpecFileButton({ file, label }: { file: SpecFileRow; label: string }) {
  const navigate = useBbNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        navigate.experimental_openFilePreview({
          target: { kind: "host", hostId: file.hostId, path: file.path },
          location: null,
        });
      }}
      className="flex min-h-9 w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-state-hover"
    >
      <Icon
        name="FileText"
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {label}
      </span>
    </button>
  );
}

function SpecsSection() {
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [files, setFiles] = useState<readonly SpecFileRow[]>([]);
  const [projects, setProjects] = useState<readonly ProjectSpecFileRow[]>([]);

  useEffect(() => {
    let active = true;
    void rpc
      .call("listSpecs")
      .then((result) => {
        if (!active) return;
        setFiles(result.files);
        setProjects(result.projects);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [rpc]);

  if (files.length === 0 && projects.length === 0) return null;

  return (
    <div className="space-y-3">
      {files.length === 0 ? null : (
        <div className="space-y-1">
          <h3 className="px-2 text-xs font-medium text-subtle-foreground">
            Specs
          </h3>
          <div className="divide-y divide-border-seam rounded-md bg-surface-raised">
            {files.map((file) => (
              <SpecFileButton key={file.path} file={file} label={file.name} />
            ))}
          </div>
        </div>
      )}
      {projects.length === 0 ? null : (
        <div className="space-y-1">
          <h3 className="px-2 text-xs font-medium text-subtle-foreground">
            Project specs
          </h3>
          <div className="divide-y divide-border-seam rounded-md bg-surface-raised">
            {projects.map((file) => (
              <SpecFileButton
                key={file.path}
                file={file}
                label={file.projectName}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelRoutingSection() {
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [hostId, setHostId] = useState<string | null | undefined>(undefined);
  const [models, setModels] = useState<readonly ModelOption[]>([]);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<
    RoutingRoleId,
    RoutingRowView
  > | null>(null);
  const [savingRole, setSavingRole] = useState<RoutingRoleId | null>(null);

  const load = useCallback(async () => {
    const result = await rpc.call("getRouting");
    setHostId(result.hostId);
    setModels(result.models);
    setProviderName(result.providerName);
    setRows({
      scout: result.scout,
      implementer: result.implementer,
      reviewer: result.reviewer,
    });
  }, [rpc]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  if (rows === null) return null;

  return (
    <ModelRoutingSectionView
      rows={rows}
      models={models}
      providerName={providerName}
      savingRole={savingRole}
      hostAvailable={hostId !== null}
      onSave={(role, model) => {
        setSavingRole(role);
        void rpc
          .call("setRouting", { role, model })
          .then((row) => {
            setRows((current) =>
              current === null ? current : { ...current, [role]: row },
            );
          })
          .catch(() => undefined)
          .finally(() => setSavingRole(null));
      }}
    />
  );
}

function WorkbenchNavPanel(_props: PluginNavPanelProps) {
  return (
    <div className="space-y-4 p-3">
      <ModelRoutingSection />
      <OrchestratedModeRow />
      <SpecsSection />
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "workbench-actions",
    scopes: ["thread"],
    actions: [
      { id: "spec-check", component: SpecCheckAction },
      { id: "task", component: TaskAction },
      { id: "bugfix", component: BugfixAction },
      { id: "goal", component: GoalAction },
    ],
    banners: [{ id: "spec-init", chrome: "card", component: SpecInitBanner }],
  });
  app.slots.navPanel({
    id: "workbench",
    title: "Workbench",
    icon: "Toolbox",
    path: "workbench",
    component: WorkbenchNavPanel,
  });
});
