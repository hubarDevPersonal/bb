import { describe, expect, it } from "vitest";
import {
  isSecretLikePath,
  redactDiffSecrets,
  redactSecrets,
} from "./secret-redaction.js";

describe("isSecretLikePath", () => {
  it("matches secret-like names anywhere in the tree", () => {
    for (const file of [
      ".env",
      "apps/api/.env.production",
      "id_rsa",
      "deploy/server.pem",
      "certs/client.key",
      "store.p12",
      "store.pfx",
      "android/release.keystore",
      "android/release.jks",
      "config/credentials.json",
      "config/credentials-prod.json",
      "k8s/secrets.yaml",
      "k8s/secrets.prod.yml",
      "secrets.json",
      "gcp/service-account-ci.json",
      "infra/prod.tfvars",
      "infra/prod.tfvars.json",
      ".aws/credentials",
      "home/.aws/credentials",
    ]) {
      expect(isSecretLikePath(file), file).toBe(true);
    }
  });

  it("leaves ordinary source and docs alone", () => {
    for (const file of [
      "src/env.ts",
      "src/credentials.ts",
      "docs/secrets.md",
      "id_rsa.pub",
      "src/keys.ts",
      "credentials/README.md",
      "aws/credentials.ts",
    ]) {
      expect(isSecretLikePath(file), file).toBe(false);
    }
  });
});

describe("redactSecrets", () => {
  it("redacts known token formats", () => {
    const input = [
      "aws = AKIAABCDEFGHIJKLMNOP",
      "exp = xpl_0123456789abcdef0123456789abcdef01234567",
      "openai = sk-proj_ABCDEFGHIJKLMNOPQRSTUV",
      "gh = ghp_ABCDEFGHIJKLMNOPQRSTUVWX",
      "gho = gho_ABCDEFGHIJKLMNOPQRSTUVWX",
      "pat = github_pat_11ABCDEFGHIJKLMNOPQRSTUV",
      "slack = xoxb-1234567890-abcdef",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
    ].join("\n");
    const result = redactSecrets(input);
    expect(result.count).toBe(8);
    expect(result.text).toBe(
      [
        "aws = [redacted]",
        "exp = [redacted]",
        "openai = [redacted]",
        "gh = [redacted]",
        "gho = [redacted]",
        "pat = [redacted]",
        "slack = [redacted]",
        "Authorization: Bearer [redacted]",
      ].join("\n"),
    );
  });

  it("redacts a PEM private key block, including one cut off by truncation", () => {
    const block =
      "+-----BEGIN RSA PRIVATE KEY-----\n+MIIEowIBAAKCAQEA\n+-----END RSA PRIVATE KEY-----\n+after";
    expect(redactSecrets(block)).toEqual({
      text: "+[redacted]\n+after",
      count: 1,
    });
    expect(
      redactSecrets("x\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg"),
    ).toEqual({ text: "x\n[redacted]", count: 1 });
  });

  it("redacts password, secret, token, and api key assignments but keeps the key name", () => {
    const result = redactSecrets(
      [
        "DB_PASSWORD=hunter2hunter2",
        '"client_secret": "s3cr3t-value-123"',
        "apiKey: abcdefgh12345678",
        "api-key = 'ZZZZZZZZZZZZ'",
        "passwd: correcthorsebattery",
      ].join("\n"),
    );
    expect(result.text).toBe(
      [
        "DB_PASSWORD=[redacted]",
        '"client_secret": "[redacted]"',
        "apiKey: [redacted]",
        "api-key = '[redacted]'",
        "passwd: [redacted]",
      ].join("\n"),
    );
    expect(result.count).toBe(5);
  });

  it("does not redact code that reads a secret or short values", () => {
    const code = [
      "const token = req.headers.authorization;",
      "password: string;",
      "const secret = getSecret(name);",
      "token = items[0]",
      "password=short",
    ].join("\n");
    expect(redactSecrets(code)).toEqual({ text: code, count: 0 });
  });
});

describe("redactDiffSecrets", () => {
  it("counts redactions per file section", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "+const k = 'AKIAABCDEFGHIJKLMNOP';",
      "+const t = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWX';",
      "diff --git a/src/b.ts b/src/b.ts",
      "+export const ok = 1;",
      "diff --git a/config/app.yml b/config/app.yml",
      "+password: verylongpassword",
      "",
    ].join("\n");
    const result = redactDiffSecrets(diff);
    expect([...result.counts]).toEqual([
      ["src/a.ts", 2],
      ["config/app.yml", 1],
    ]);
    expect(result.text).not.toContain("AKIA");
    expect(result.text).toContain("+export const ok = 1;");
    expect(result.text).toContain("+password: [redacted]");
  });
});
