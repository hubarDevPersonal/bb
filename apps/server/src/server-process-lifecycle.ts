import type { DataDirectoryLockLogger } from "@bb/process-utils/data-directory-lock";

const TERMINATION_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

/**
 * A shutdown that cannot finish must not leave the server serving requests
 * after it has lost exclusive ownership of the data directory.
 */
export const DEFAULT_SERVER_SHUTDOWN_EXIT_GRACE_MS = 15_000;

interface SignalSource {
  once(event: NodeJS.Signals, listener: () => void): void;
  off(event: NodeJS.Signals, listener: () => void): void;
}

export interface ServerShutdownTarget {
  logger: Pick<DataDirectoryLockLogger, "error">;
  shutdown(): Promise<void>;
}

interface CreateServerProcessLifecycleOptions {
  forceExit?: (code: number) => void;
  getActiveResources?: () => string[];
  shutdownExitGraceMs?: number;
  signalSource?: SignalSource;
}

export interface ServerProcessLifecycle {
  attach(server: ServerShutdownTarget): void;
  handleLockLost(): void;
}

export function createServerProcessLifecycle(
  options: CreateServerProcessLifecycleOptions = {},
): ServerProcessLifecycle {
  const forceExit = options.forceExit ?? ((code) => process.exit(code));
  const getActiveResources =
    options.getActiveResources ?? (() => process.getActiveResourcesInfo());
  const signalSource = options.signalSource ?? process;
  const shutdownExitGraceMs =
    options.shutdownExitGraceMs ?? DEFAULT_SERVER_SHUTDOWN_EXIT_GRACE_MS;
  const listeners = new Map<NodeJS.Signals, () => void>();

  let server: ServerShutdownTarget | null = null;
  let shutdownStarted = false;

  function unregisterSignalHandlers(): void {
    for (const [signal, listener] of listeners) {
      signalSource.off(signal, listener);
    }
    listeners.clear();
  }

  function shutdownAndExit(reason: string, exitCode: number): void {
    if (shutdownStarted) return;
    shutdownStarted = true;
    unregisterSignalHandlers();

    const runningServer = server;
    if (runningServer === null) {
      forceExit(exitCode);
      return;
    }

    const watchdog = setTimeout(() => {
      runningServer.logger.error(
        {
          activeResources: getActiveResources(),
          graceMs: shutdownExitGraceMs,
          reason,
        },
        "Server shutdown did not end the process; forcing exit",
      );
      forceExit(exitCode);
    }, shutdownExitGraceMs);
    watchdog.unref?.();

    void runningServer
      .shutdown()
      .catch((error: unknown) => {
        runningServer.logger.error(
          { err: error, reason },
          "Server shutdown failed",
        );
      })
      .finally(() => {
        clearTimeout(watchdog);
        forceExit(exitCode);
      });
  }

  return {
    attach(runningServer) {
      if (server !== null) {
        throw new Error("Server process lifecycle is already attached");
      }
      server = runningServer;
      for (const signal of TERMINATION_SIGNALS) {
        const listener = () => shutdownAndExit(signal, 0);
        listeners.set(signal, listener);
        signalSource.once(signal, listener);
      }
    },

    handleLockLost() {
      shutdownAndExit("server-lock-lost", 1);
    },
  };
}
