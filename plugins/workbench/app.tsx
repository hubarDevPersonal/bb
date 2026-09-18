import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  definePluginApp,
  useBbNavigate,
  useComposerView,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  type PluginNavPanelProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Switch } from "@bb/shared-ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import {
  DescriptionDialogView,
  type DescriptionDialogViewProps,
} from "./description-dialog.js";
import { GOAL_MAX_TASKS_DEFAULT, GoalDialogView } from "./goal-dialog.js";
import {
  WORKBENCH_SUBAGENTS_REALTIME_CHANNEL,
  workbenchSubagentsSignalParentThreadId,
} from "./realtime-channel.js";
import {
  ModelRoutingSectionView,
  type ModelOption,
  type ProviderOption,
  type RoutingRoleId,
  type RoutingRowView,
} from "./model-routing.js";
import {
  SubagentsDoneCardView,
  SubagentsPanelView,
  type SubagentOutputView,
  type SubagentRowView,
} from "./subagents-panel.js";
import type { workbenchRpcContract } from "./server.js";

const SUBAGENTS_PANEL_ACTION_ID = "subagents";
const SUBAGENTS_POLL_INTERVAL_MS = 3_000;
const SUBAGENTS_NOW_TICK_MS = 30_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ComposerActionButton = forwardRef<
  HTMLButtonElement,
  {
    icon: IconName;
    label: string;
    disabled?: boolean;
    onClick: () => void;
  }
>(function ComposerActionButton({ icon, label, disabled, onClick }, ref) {
  return (
    <button
      ref={ref}
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
});

function useThreadId(): string | null {
  const view = useComposerView();
  return view.scope.kind === "thread" ? view.scope.threadId : null;
}

function SpecCheckAction() {
  const threadId = useThreadId();
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (threadId === null) return null;
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip open={error !== null} onOpenChange={() => setError(null)}>
        <TooltipTrigger asChild>
          <ComposerActionButton
            icon="CircleCheck"
            label="Spec check"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError(null);
              void rpc
                .call("runSpecCheck", { threadId })
                .catch((sendError) => setError(errorMessage(sendError)))
                .finally(() => setBusy(false));
            }}
          />
        </TooltipTrigger>
        {error === null ? null : (
          <TooltipContent className="text-destructive-text">
            {error}
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
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
  const [error, setError] = useState<string | null>(null);

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
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-raised-solid px-3 py-2"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">
          No project spec yet
        </p>
        <p className="text-xs text-subtle-foreground">
          .claude/specs/PROJECT.md is missing
        </p>
        {error === null ? null : (
          <p className="text-xs text-destructive-text">{error}</p>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        disabled={running}
        className="bg-primary text-primary-foreground hover:bg-primary/90"
        onClick={() => {
          setRunning(true);
          setError(null);
          void rpc
            .call("runSpecInit", { threadId })
            .then(() => setShow(false))
            .catch((runError) => setError(errorMessage(runError)))
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void rpc
      .call("getOrchestratedMode")
      .then((result) => {
        if (active) setEnabled(result.enabled);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, [rpc]);

  return (
    <div className="space-y-1">
      <div className="flex items-start justify-between gap-3 rounded-md bg-surface-raised px-2 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">
            Orchestrated mode
          </p>
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
            setError(null);
            void rpc
              .call("setOrchestratedMode", { enabled: next })
              .catch((saveError) => {
                setEnabled((current) => (current === next ? !next : current));
                setError(errorMessage(saveError));
              })
              .finally(() => setSaving(false));
          }}
        />
      </div>
      {error === null ? null : (
        <p className="px-2 text-xs text-destructive-text">{error}</p>
      )}
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

function SpecFileButton({
  file,
  secondary,
}: {
  file: SpecFileRow;
  secondary: string;
}) {
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
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {file.name}
        </span>
        <span className="block truncate text-xs text-subtle-foreground">
          {secondary}
        </span>
      </span>
    </button>
  );
}

function SpecsSection() {
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [files, setFiles] = useState<readonly SpecFileRow[]>([]);
  const [projects, setProjects] = useState<readonly ProjectSpecFileRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void rpc
      .call("listSpecs")
      .then((result) => {
        if (!active) return;
        setFiles(result.files);
        setProjects(result.projects);
      })
      .catch((loadError) => {
        if (active) setError(errorMessage(loadError));
      });
    return () => {
      active = false;
    };
  }, [rpc]);

  if (files.length === 0 && projects.length === 0 && error === null) {
    return null;
  }

  return (
    <div className="space-y-3">
      {files.length === 0 ? null : (
        <div className="space-y-1">
          <h3 className="px-2 text-xs font-medium text-subtle-foreground">
            Specs
          </h3>
          <div className="rounded-md bg-surface-raised">
            {files.map((file) => (
              <SpecFileButton
                key={file.path}
                file={file}
                secondary={file.path}
              />
            ))}
          </div>
        </div>
      )}
      {projects.length === 0 ? null : (
        <div className="space-y-1">
          <h3 className="px-2 text-xs font-medium text-subtle-foreground">
            Project specs
          </h3>
          <div className="rounded-md bg-surface-raised">
            {projects.map((file) => (
              <SpecFileButton
                key={file.path}
                file={file}
                secondary={file.projectName}
              />
            ))}
          </div>
        </div>
      )}
      {error === null ? null : (
        <p className="px-2 text-xs text-destructive-text">{error}</p>
      )}
    </div>
  );
}

function ModelRoutingSection() {
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [hostId, setHostId] = useState<string | null | undefined>(undefined);
  const [models, setModels] = useState<readonly ModelOption[]>([]);
  const [providers, setProviders] = useState<readonly ProviderOption[]>([]);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<
    RoutingRoleId,
    RoutingRowView
  > | null>(null);
  const [savingRole, setSavingRole] = useState<RoutingRoleId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (requestedProviderId: string | null) => {
      const result = await rpc.call("getRouting", {
        providerId: requestedProviderId,
      });
      setHostId(result.hostId);
      setModels(result.models);
      setProviders(result.providers);
      setProviderId(result.providerId);
      setProviderName(result.providerName);
      setRows({
        scout: result.scout,
        implementer: result.implementer,
        reviewer: result.reviewer,
      });
    },
    [rpc],
  );

  useEffect(() => {
    void load(null).catch((loadError) => setError(errorMessage(loadError)));
  }, [load]);

  if (rows === null) {
    return error === null ? null : (
      <p className="px-2 text-xs text-destructive-text">{error}</p>
    );
  }

  return (
    <div className="space-y-1">
      <ModelRoutingSectionView
        rows={rows}
        models={models}
        providers={providers}
        providerId={providerId}
        providerName={providerName}
        savingRole={savingRole}
        hostAvailable={hostId !== null}
        onProviderChange={(nextProviderId) => {
          setError(null);
          void load(nextProviderId).catch((loadError) =>
            setError(errorMessage(loadError)),
          );
        }}
        onSave={(role, model) => {
          setSavingRole(role);
          setError(null);
          void rpc
            .call("setRouting", { role, model })
            .then((row) => {
              setRows((current) =>
                current === null ? current : { ...current, [role]: row },
              );
            })
            .catch((saveError) => setError(errorMessage(saveError)))
            .finally(() => setSavingRole(null));
        }}
      />
      {error === null ? null : (
        <p className="px-2 text-xs text-destructive-text">{error}</p>
      )}
    </div>
  );
}

function subscribeDocumentVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function readDocumentVisible(): boolean {
  return document.visibilityState !== "hidden";
}

function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeDocumentVisibility,
    readDocumentVisible,
    () => true,
  );
}

function useVisibleActivePolling(
  refresh: () => Promise<void>,
  active: boolean,
): void {
  const visible = useDocumentVisible();
  const connection = useRealtimeConnectionState();
  const wasHidden = useRef(false);
  const wasDisconnected = useRef(false);

  useEffect(() => {
    if (!visible) {
      wasHidden.current = true;
      return;
    }
    if (!wasHidden.current) return;
    wasHidden.current = false;
    void refresh();
  }, [refresh, visible]);

  useEffect(() => {
    if (connection !== "connected") {
      wasDisconnected.current = true;
      return;
    }
    if (!wasDisconnected.current) return;
    wasDisconnected.current = false;
    void refresh();
  }, [connection, refresh]);

  const enabled = active && visible;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timeout: number | null = null;
    const schedule = () => {
      timeout = window.setTimeout(() => {
        void refresh().finally(() => {
          if (!cancelled) schedule();
        });
      }, SUBAGENTS_POLL_INTERVAL_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [enabled, refresh]);
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

type SubagentsListLoadState =
  | { status: "loading" }
  | { status: "ready"; subagents: SubagentRowView[] }
  | { status: "error" };

function useSubagentsList(threadId: string): {
  state: SubagentsListLoadState;
} {
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [state, setState] = useState<SubagentsListLoadState>({
    status: "loading",
  });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const result = await rpc.call("threadSubagents", { threadId });
      if (sequence === requestSequence.current) {
        setState({ status: "ready", subagents: result.subagents });
      }
    } catch {
      if (sequence === requestSequence.current) setState({ status: "error" });
    }
  }, [rpc, threadId]);

  useEffect(() => {
    setState({ status: "loading" });
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  useRealtime(WORKBENCH_SUBAGENTS_REALTIME_CHANNEL, (payload) => {
    if (workbenchSubagentsSignalParentThreadId(payload) === threadId) {
      void refresh();
    }
  });

  const shouldPoll =
    state.status === "error" ||
    (state.status === "ready" &&
      state.subagents.some((subagent) => subagent.status === "active"));
  useVisibleActivePolling(refresh, shouldPoll);

  return { state };
}

type SubagentsPanelLoadState =
  | { status: "loading" }
  | {
      status: "ready";
      subagents: SubagentRowView[];
      outputs: SubagentOutputView[];
    }
  | { status: "error" };

function useSubagentsPanelData(threadId: string): {
  state: SubagentsPanelLoadState;
} {
  const rpc = useRpc<typeof workbenchRpcContract>();
  const [state, setState] = useState<SubagentsPanelLoadState>({
    status: "loading",
  });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const [subagentsResult, outputsResult] = await Promise.all([
        rpc.call("threadSubagents", { threadId }),
        rpc.call("threadOutputs", { threadId }),
      ]);
      if (sequence === requestSequence.current) {
        setState({
          status: "ready",
          subagents: subagentsResult.subagents,
          outputs: outputsResult.outputs,
        });
      }
    } catch {
      if (sequence === requestSequence.current) setState({ status: "error" });
    }
  }, [rpc, threadId]);

  useEffect(() => {
    setState({ status: "loading" });
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  useRealtime(WORKBENCH_SUBAGENTS_REALTIME_CHANNEL, (payload) => {
    if (workbenchSubagentsSignalParentThreadId(payload) === threadId) {
      void refresh();
    }
  });

  const shouldPoll =
    state.status === "error" ||
    (state.status === "ready" &&
      state.subagents.some((subagent) => subagent.status === "active"));
  useVisibleActivePolling(refresh, shouldPoll);

  return { state };
}

function SubagentsThreadPanel({ threadId }: PluginThreadPanelProps) {
  const { state } = useSubagentsPanelData(threadId);
  const navigate = useBbNavigate();
  const now = useNow(SUBAGENTS_NOW_TICK_MS);

  if (state.status === "error") {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Could not load subagents.
      </div>
    );
  }
  if (state.status === "loading") return null;

  return (
    <SubagentsPanelView
      now={now}
      subagents={state.subagents}
      outputs={state.outputs}
      onSelectSubagent={(id) => navigate.toThread(id)}
      onSelectOutput={(output) =>
        navigate.experimental_openFilePreview({
          target: output,
          location: null,
        })
      }
    />
  );
}

function SubagentsDoneBanner() {
  const view = useComposerView();
  if (view.scope.kind !== "thread") return null;
  return (
    <SubagentsDoneBannerForThread
      key={view.scope.threadId}
      threadId={view.scope.threadId}
    />
  );
}

function SubagentsDoneBannerForThread({ threadId }: { threadId: string }) {
  const { state } = useSubagentsList(threadId);
  const navigate = useBbNavigate();
  if (state.status !== "ready") return null;

  const done = state.subagents.filter((subagent) => subagent.status === "done");
  if (done.length === 0) return null;
  const active = state.subagents.filter(
    (subagent) => subagent.status === "active",
  );

  return (
    <SubagentsDoneCardView
      doneNames={done.map((subagent) => subagent.title)}
      doneCount={done.length}
      activeCount={active.length}
      onView={() => {
        navigate.openThreadPanel({ actionId: SUBAGENTS_PANEL_ACTION_ID });
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
    banners: [
      { id: "spec-init", chrome: "bare", component: SpecInitBanner },
      {
        id: "subagents-done",
        chrome: "bare",
        component: SubagentsDoneBanner,
      },
    ],
  });
  app.slots.navPanel({
    id: "workbench",
    title: "Workbench",
    icon: "Toolbox",
    path: "workbench",
    component: WorkbenchNavPanel,
  });
  app.slots.threadPanelAction({
    id: SUBAGENTS_PANEL_ACTION_ID,
    title: "Subagents",
    icon: "Bot",
    component: SubagentsThreadPanel,
    layout: "flush",
  });
});
