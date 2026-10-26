const REDACTED = "[redacted]";

const SECRET_LIKE_BASENAME =
  /^(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pgpass|id_[a-z0-9]+|credentials.*\.json|secrets.*\.(?:json|ya?ml)|service-account.*\.json|.*\.tfvars(?:\.json)?|.*\.(?:pem|key|p12|pfx|jks|keystore))$/i;

const SECRET_LIKE_PATH = /(?:^|\/)\.aws\/credentials$/i;

export function isSecretLikePath(file: string): boolean {
  const normalized = file.replace(/\\/g, "/");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    SECRET_LIKE_BASENAME.test(basename) || SECRET_LIKE_PATH.test(normalized)
  );
}

const VALUE_CHARS = "A-Za-z0-9_\\-+/=!@#$%^&*~";

const SECRET_PATTERNS: readonly { pattern: RegExp; keepPrefix: boolean }[] = [
  {
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
    keepPrefix: false,
  },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, keepPrefix: false },
  { pattern: /\bxpl_[0-9a-f]{40}\b/g, keepPrefix: false },
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}/g, keepPrefix: false },
  { pattern: /\bgh[po]_[A-Za-z0-9]{20,}/g, keepPrefix: false },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, keepPrefix: false },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, keepPrefix: false },
  { pattern: /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/g, keepPrefix: true },
  {
    pattern: new RegExp(
      `([A-Za-z0-9_-]*(?:password|passwd|secret|token|api[_-]?key)[A-Za-z0-9_-]*["']?\\s*[:=]\\s*["']?)[${VALUE_CHARS}]{8,}(?![${VALUE_CHARS}(.[])`,
      "gi",
    ),
    keepPrefix: true,
  },
];

export function redactSecrets(text: string): { text: string; count: number } {
  let count = 0;
  let result = text;
  for (const { pattern, keepPrefix } of SECRET_PATTERNS) {
    result = result.replace(pattern, (_match: string, prefix: unknown) => {
      count += 1;
      return keepPrefix && typeof prefix === "string"
        ? `${prefix}${REDACTED}`
        : REDACTED;
    });
  }
  return { text: result, count };
}

function diffSectionPath(header: string): string {
  const firstLine = header.slice(0, header.indexOf("\n") + 1 || undefined);
  const marker = firstLine.lastIndexOf(" b/");
  return marker === -1 ? firstLine.trim() : firstLine.slice(marker + 3).trim();
}

export function redactDiffSecrets(diff: string): {
  text: string;
  counts: Map<string, number>;
} {
  const counts = new Map<string, number>();
  const sections = diff.split(/(?=^diff --git )/m);
  const redacted = sections.map((section) => {
    const result = redactSecrets(section);
    if (result.count > 0) {
      const file = diffSectionPath(section);
      counts.set(file, (counts.get(file) ?? 0) + result.count);
    }
    return result.text;
  });
  return { text: redacted.join(""), counts };
}
