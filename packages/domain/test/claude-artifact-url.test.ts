import { describe, expect, it } from "vitest";
import { isClaudeArtifactUrl } from "../src/claude-artifact-url.js";

describe("isClaudeArtifactUrl", () => {
  it("accepts the artifact URLs Claude Code publishes and links", () => {
    for (const url of [
      "https://claude.ai/code/artifact/0b3c9a52-6f1e-4d7a-9c1b-2f8e4a6d5c3b",
      "https://claude.ai/artifact/abc123",
      "https://claude.ai/public/artifacts/0b3c9a52-6f1e-4d7a-9c1b-2f8e4a6d5c3b",
      "https://www.claude.ai/artifact/abc123/",
      "https://claude.ai/code/artifact/abc123/versions/2",
      "HTTPS://CLAUDE.AI/artifact/abc123?tab=comments#c1",
    ]) {
      expect(isClaudeArtifactUrl(url), url).toBe(true);
    }
  });

  it("rejects other claude.ai pages, lookalike hosts, and unsafe forms", () => {
    for (const url of [
      "https://claude.ai/",
      "https://claude.ai/artifact/",
      "https://claude.ai/chat/abc123",
      "https://claude.ai/artifacts/my",
      "https://claude.ai/code/artifacts/abc123",
      "https://claude.ai/public/artifact/abc123",
      "http://claude.ai/artifact/abc123",
      "https://claude.ai.evil.example/artifact/abc123",
      "https://evil.example/claude.ai/artifact/abc123",
      "https://user@claude.ai/artifact/abc123",
      "https://claude.ai:8443/artifact/abc123",
      "claude.ai/artifact/abc123",
      "not a url",
    ]) {
      expect(isClaudeArtifactUrl(url), url).toBe(false);
    }
  });
});
