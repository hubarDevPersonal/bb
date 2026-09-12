import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Wire format of NotchAgent (Sources/Shared/Models.swift): one JSON line per
// connection. For PermissionRequest the app keeps the connection open and
// answers with one HookResponse line once the human decides.
export interface HookEvent {
  id: string;
  type:
    | "PermissionRequest"
    | "PostToolUse"
    | "Stop"
    | "Poll"
    | "Notification"
    | "Status"
    | "Cancel";
  tool_name?: string;
  tool_input?: string;
  tool_result?: string;
  message?: string;
  session_id?: string;
  stop_reason?: string;
  choices?: string[];
}

export interface HookResponse {
  id: string;
  action: "approve" | "always_allow" | "deny" | string;
  message?: string;
}

export function defaultNotchSocketPath(): string {
  // NotchAgentConstants.socketPath = NSTemporaryDirectory() + "notch-agent.sock".
  // Node's tmpdir() strips the trailing slash macOS keeps; join() restores it.
  return process.env.NOTCH_SOCKET ?? join(tmpdir(), "notch-agent.sock");
}

export class NotchClient {
  constructor(private readonly socketPath: string = defaultNotchSocketPath()) {}

  isAvailable(): boolean {
    return existsSync(this.socketPath);
  }

  // Fire-and-forget event: NotchAgent closes the socket right after reading it.
  send(event: HookEvent): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path: this.socketPath });
      socket.once("error", reject);
      socket.once("connect", () => {
        socket.end(`${JSON.stringify(event)}\n`, () => resolve());
      });
    });
  }

  // Blocking request: resolves with the human's decision, or null when the
  // app dropped the connection (stale cleanup after ~130 s, or app quit).
  ask(event: HookEvent, timeoutMs: number): Promise<HookResponse | null> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path: this.socketPath });
      let buffer = "";
      let settled = false;
      const finish = (value: HookResponse | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      socket.setEncoding("utf8");
      socket.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
      socket.once("connect", () => {
        socket.write(`${JSON.stringify(event)}\n`);
      });
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline === -1) return;
        try {
          finish(JSON.parse(buffer.slice(0, newline)) as HookResponse);
        } catch {
          finish(null);
        }
      });
      socket.once("close", () => finish(null));
    });
  }
}
