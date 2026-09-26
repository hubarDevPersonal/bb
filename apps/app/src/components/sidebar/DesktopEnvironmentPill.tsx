import { useState, type MouseEvent } from "react";
import type { BbDesktopEnvironment } from "@bb/desktop-contract";
import type { SystemProviderState } from "@bb/server-contract";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { useSystemProviderStates } from "@/hooks/queries/system-queries";
import { useDesktopEnvironment } from "@/hooks/useDesktopEnvironment";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

const ENVIRONMENT_DOT_CLASS: Record<BbDesktopEnvironment["color"], string> = {
  blue: "bg-palette-blue",
  green: "bg-palette-green",
  orange: "bg-palette-orange",
  purple: "bg-palette-purple",
  yellow: "bg-palette-yellow",
  pink: "bg-palette-pink",
};

export function describeProviderAccount(state: SystemProviderState): string {
  if (state.status === "ready") {
    const account = state.accountEmail ?? "signed in";
    return state.planLabel ? `${account} · ${state.planLabel}` : account;
  }
  if (state.status === "unauthenticated" || state.status === "expired") {
    return "not signed in";
  }
  if (state.status === "not_installed") {
    return "not installed";
  }
  return state.statusMessage ?? state.status;
}

function EnvironmentAccounts() {
  const providerStates = useSystemProviderStates({ poll: false });
  if (providerStates.isPending) {
    return <span className="text-muted-foreground">Checking accounts…</span>;
  }
  const providers = providerStates.data?.providers ?? [];
  if (providers.length === 0) {
    return <span className="text-muted-foreground">No providers</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {providers.map((provider) => (
        <li key={provider.providerId} className="flex gap-1.5">
          <span className="font-medium">{provider.displayName}</span>
          <span className="text-muted-foreground">
            {describeProviderAccount(provider)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DesktopEnvironmentPill({ className }: { className?: string }) {
  const environment = useDesktopEnvironment();
  const [open, setOpen] = useState(false);
  if (environment === null) {
    return null;
  }

  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    getBbDesktopInfo()?.openEnvironmentMenu?.({
      x: rect.left,
      y: rect.bottom + 4,
    });
  };

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="desktop-environment-pill"
          aria-label={`Environment: ${environment.name}. Switch environment`}
          onClick={openMenu}
          className={cn(
            "flex h-6 min-w-0 max-w-40 shrink items-center gap-1.5 rounded-full px-2",
            "text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
            className,
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              ENVIRONMENT_DOT_CLASS[environment.color],
            )}
          />
          <span className="min-w-0 truncate">{environment.name}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="text-xs">
        <div className="flex flex-col gap-1">
          <span className="font-medium">
            {environment.name}
            {environment.destination ? (
              <span className="text-muted-foreground">
                {" "}
                · {environment.destination}
              </span>
            ) : null}
          </span>
          {open ? <EnvironmentAccounts /> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
