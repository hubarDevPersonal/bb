const CLAUDE_ARTIFACT_HOSTS: ReadonlySet<string> = new Set([
  "claude.ai",
  "www.claude.ai",
]);

const CLAUDE_ARTIFACT_PATH_PATTERN =
  /^\/(?:artifact|code\/artifact|public\/artifacts)\/[^/]+(?:\/.*)?$/u;

export function isClaudeArtifactUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.username === "" &&
    parsed.password === "" &&
    parsed.port === "" &&
    CLAUDE_ARTIFACT_HOSTS.has(parsed.hostname) &&
    CLAUDE_ARTIFACT_PATH_PATTERN.test(parsed.pathname)
  );
}
