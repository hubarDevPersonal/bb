import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createServerProcessLifecycle,
  DEFAULT_SERVER_SHUTDOWN_EXIT_GRACE_MS,
  type ServerShutdownTarget,
} from "./server-process-lifecycle.js";

function createTarget(shutdown: () => Promise<void>): {
  errors: string[];
  target: ServerShutdownTarget;
} {
  const errors: string[] = [];
  return {
    errors,
    target: {
      logger: {
        error: (_fields, message) => errors.push(message),
      },
      shutdown,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("server process lifecycle", () => {
  it("forces exit when lock-loss shutdown does not settle", async () => {
    vi.useFakeTimers();
    const forceExit = vi.fn();
    const { errors, target } = createTarget(() => new Promise(() => undefined));
    const lifecycle = createServerProcessLifecycle({
      forceExit,
      getActiveResources: () => ["TCPServerWrap"],
    });
    lifecycle.attach(target);

    lifecycle.handleLockLost();
    await vi.advanceTimersByTimeAsync(
      DEFAULT_SERVER_SHUTDOWN_EXIT_GRACE_MS - 1,
    );
    expect(forceExit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(forceExit).toHaveBeenCalledOnce();
    expect(forceExit).toHaveBeenCalledWith(1);
    expect(errors).toContain(
      "Server shutdown did not end the process; forcing exit",
    );
  });

  it("clears the watchdog when lock-loss shutdown settles", async () => {
    vi.useFakeTimers();
    const forceExit = vi.fn();
    const shutdown = vi.fn(async () => undefined);
    const { target } = createTarget(shutdown);
    const lifecycle = createServerProcessLifecycle({ forceExit });
    lifecycle.attach(target);

    lifecycle.handleLockLost();
    await vi.runAllTimersAsync();

    expect(shutdown).toHaveBeenCalledOnce();
    expect(forceExit).toHaveBeenCalledOnce();
    expect(forceExit).toHaveBeenCalledWith(1);
  });

  it("releases through the normal shutdown path on a termination signal", async () => {
    const signalSource = new EventEmitter();
    const forceExit = vi.fn();
    const shutdown = vi.fn(async () => undefined);
    const { target } = createTarget(shutdown);
    const lifecycle = createServerProcessLifecycle({
      forceExit,
      signalSource,
    });
    lifecycle.attach(target);

    signalSource.emit("SIGTERM");
    await vi.waitFor(() => expect(forceExit).toHaveBeenCalledWith(0));

    expect(shutdown).toHaveBeenCalledOnce();
    signalSource.emit("SIGINT");
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it("exits immediately when the lock is lost before startup finishes", () => {
    const forceExit = vi.fn();
    const lifecycle = createServerProcessLifecycle({ forceExit });

    lifecycle.handleLockLost();

    expect(forceExit).toHaveBeenCalledWith(1);
  });
});
