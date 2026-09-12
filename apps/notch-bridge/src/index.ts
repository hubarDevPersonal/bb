import { createNodeBbSdk } from "@bb/sdk/node";
import { NotchBridge } from "./bridge.js";
import { NotchClient, defaultNotchSocketPath } from "./notch-client.js";

const baseUrl = process.env.BB_SERVER_URL ?? "http://127.0.0.1:38886";
const stamp = () => new Date().toISOString().slice(11, 19);
const log = {
  info: (message: string) => process.stdout.write(`[${stamp()}] ${message}\n`),
  warn: (message: string) => process.stderr.write(`[${stamp()}] WARN ${message}\n`),
};

const notch = new NotchClient();
if (!notch.isAvailable()) {
  log.warn(`NotchAgent socket not found at ${defaultNotchSocketPath()} — start NotchAgent first`);
}

const bridge = new NotchBridge({ sdk: createNodeBbSdk({ baseUrl }), notch, log });
await bridge.start();
log.info(`bb-notch: watching ${baseUrl}, notch at ${defaultNotchSocketPath()}`);

const shutdown = () => {
  bridge.stop();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
