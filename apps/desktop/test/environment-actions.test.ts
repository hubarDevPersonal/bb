import { describe, expect, it } from "vitest";
import {
  buildTerminalScript,
  planEnvironmentActions,
  shellQuote,
} from "../src/environment-actions.js";
import type {
  DesktopEnvironment,
  EnvironmentSharedSettings,
} from "../src/environments.js";

const shared: EnvironmentSharedSettings = {
  rulesSource: "~/Dev/claude-dotfiles/agent/",
  rulesTarget: "~/Dev/claude-agent",
  rulesInstall: "sh install-agent.sh",
};

const vps: DesktopEnvironment = {
  id: "vps",
  name: "VPS",
  color: "green",
  kind: "ssh",
  syncRules: true,
  actions: [{ id: "logs", label: "Tail bb logs", command: "echo logs" }],
  ssh: {
    destination: "artem@host",
    identityFile: "~/.ssh/id_test",
    remotePort: 38886,
    localPort: 38901,
    startCommand: null,
    updateCommand: "cd ~/Dev/bb && git pull --ff-only",
  },
};

const mac: DesktopEnvironment = {
  id: "mac",
  name: "This Mac",
  color: "blue",
  kind: "local",
  syncRules: true,
  actions: [],
  ssh: null,
};

function planById(environment: DesktopEnvironment) {
  return new Map(
    planEnvironmentActions(environment, shared, "/home/me").map((plan) => [
      plan.id,
      plan,
    ]),
  );
}

describe("planEnvironmentActions", () => {
  it("syncs shared rules to the remote target and runs the installer there", () => {
    const script = planById(vps).get("sync-rules")?.script;
    expect(script).toContain(
      "ssh -o BatchMode=yes -o ConnectTimeout=10 -i /home/me/.ssh/id_test -o IdentitiesOnly=yes artem@host 'mkdir -p Dev/claude-agent'",
    );
    expect(script).toContain(
      "rsync -az --exclude .git -e 'ssh -o BatchMode=yes -o ConnectTimeout=10 -i /home/me/.ssh/id_test -o IdentitiesOnly=yes' /home/me/Dev/claude-dotfiles/agent/ artem@host:Dev/claude-agent/",
    );
    expect(script).toContain(
      "artem@host 'cd Dev/claude-agent && sh install-agent.sh'",
    );
    expect(script).not.toContain("--delete");
  });

  it("runs the installer in place for this computer", () => {
    expect(planById(mac).get("sync-rules")?.script).toBe(
      "cd /home/me/Dev/claude-dotfiles/agent && sh install-agent.sh",
    );
  });

  it("logs in over an interactive ssh session and forwards the codex callback", () => {
    const plans = planById(vps);
    expect(plans.get("login-claude")?.script).toBe(
      "ssh -t -o ConnectTimeout=10 -i /home/me/.ssh/id_test -o IdentitiesOnly=yes artem@host 'claude /login'",
    );
    expect(plans.get("login-codex")?.script).toBe(
      "ssh -t -o ConnectTimeout=10 -i /home/me/.ssh/id_test -o IdentitiesOnly=yes -L 1455:127.0.0.1:1455 artem@host 'codex login'",
    );
    expect(plans.get("open-shell")?.script).toBe(
      "ssh -t -o ConnectTimeout=10 -i /home/me/.ssh/id_test -o IdentitiesOnly=yes artem@host",
    );
  });

  it("offers update only for ssh environments that configure it, plus custom actions", () => {
    expect(planById(vps).get("update-bb")?.script).toContain(
      "'cd ~/Dev/bb && git pull --ff-only'",
    );
    expect(planById(mac).has("update-bb")).toBe(false);
    expect(planById(vps).get("custom:logs")?.script).toBe("echo logs");
  });

  it("omits rule sync for an environment that opts out", () => {
    expect(
      planEnvironmentActions({ ...mac, syncRules: false }, shared, "/h").some(
        (plan) => plan.id === "sync-rules",
      ),
    ).toBe(false);
  });

  it("omits rule sync when no shared rules source is configured", () => {
    expect(
      planEnvironmentActions(vps, { ...shared, rulesSource: null }, "/h").some(
        (plan) => plan.id === "sync-rules",
      ),
    ).toBe(false);
  });
});

describe("buildTerminalScript", () => {
  it("exports the environment and keeps the window open with the status", () => {
    const script = buildTerminalScript(vps, {
      id: "custom:logs",
      label: "Tail bb logs",
      script: "echo logs",
    });
    expect(script.startsWith("#!/bin/bash\n")).toBe(true);
    expect(script).toContain("export BB_ENV_ID=vps");
    expect(script).toContain("export BB_ENV_SSH_DESTINATION=artem@host");
    expect(script).toContain("\necho logs\nstatus=$?\n");
    expect(script).toContain('read -r -p "Press Return to close…" _');
  });
});

describe("shellQuote", () => {
  it("leaves plain words alone and single-quotes the rest", () => {
    expect(shellQuote("artem@host:Dev/x/")).toBe("artem@host:Dev/x/");
    expect(shellQuote("it's here")).toBe(`'it'"'"'s here'`);
  });
});
