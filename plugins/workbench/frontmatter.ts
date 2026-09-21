export type FrontmatterModelError = "missing_frontmatter" | "missing_model_key";

export type FrontmatterModelReadResult =
  | { ok: true; model: string }
  | { ok: false; error: FrontmatterModelError };

export type FrontmatterModelWriteResult =
  | { ok: true; content: string }
  | { ok: false; error: FrontmatterModelError };

export type FrontmatterKey = "model" | "effort";

export type FrontmatterKeyReadResult =
  | { ok: true; value: string | null }
  | { ok: false; error: "missing_frontmatter" };

export type FrontmatterKeyWriteResult =
  | { ok: true; content: string }
  | { ok: false; error: "missing_frontmatter" };

const LINE_PATTERN = /[^\n]*\n|[^\n]+$/g;
const KEY_LINE_PATTERNS: Readonly<Record<FrontmatterKey, RegExp>> = {
  model: /^model\s*:(.*)$/,
  effort: /^effort\s*:(.*)$/,
};

function splitLines(content: string): string[] {
  return content.match(LINE_PATTERN) ?? [];
}

function lineBody(line: string): string {
  return line.replace(/\r?\n$/, "");
}

function lineTerminator(line: string): string {
  return line.slice(lineBody(line).length);
}

function findFrontmatterRange(
  lines: readonly string[],
): { start: number; end: number } | null {
  if (lines.length === 0 || lineBody(lines[0]!) !== "---") return null;
  for (let index = 1; index < lines.length; index += 1) {
    if (lineBody(lines[index]!) === "---") {
      return { start: 1, end: index };
    }
  }
  return null;
}

function findKeyLineIndex(
  lines: readonly string[],
  range: { start: number; end: number },
  key: FrontmatterKey,
): number | null {
  for (let index = range.start; index < range.end; index += 1) {
    if (KEY_LINE_PATTERNS[key].test(lineBody(lines[index]!))) return index;
  }
  return null;
}

function unquoteYamlScalar(raw: string): string {
  const trimmed = raw.trim();
  const quote = trimmed.charAt(0);
  if (
    trimmed.length >= 2 &&
    (quote === '"' || quote === "'") &&
    trimmed.endsWith(quote)
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed.replace(/\s+#.*$/, "").trim();
}

function keyValue(line: string, key: FrontmatterKey): string {
  const match = KEY_LINE_PATTERNS[key].exec(lineBody(line))!;
  return unquoteYamlScalar(match[1]!);
}

export function readFrontmatterKey(
  content: string,
  key: FrontmatterKey,
): FrontmatterKeyReadResult {
  const lines = splitLines(content);
  const range = findFrontmatterRange(lines);
  if (range === null) return { ok: false, error: "missing_frontmatter" };
  const index = findKeyLineIndex(lines, range, key);
  return {
    ok: true,
    value: index === null ? null : keyValue(lines[index]!, key),
  };
}

export function upsertFrontmatterKey(
  content: string,
  key: FrontmatterKey,
  value: string,
): FrontmatterKeyWriteResult {
  const lines = splitLines(content);
  const range = findFrontmatterRange(lines);
  if (range === null) return { ok: false, error: "missing_frontmatter" };
  const index = findKeyLineIndex(lines, range, key);
  if (index !== null) {
    lines[index] = `${key}: ${value}${lineTerminator(lines[index]!)}`;
    return { ok: true, content: lines.join("") };
  }
  const modelIndex = findKeyLineIndex(lines, range, "model");
  const insertAt = modelIndex === null ? range.end : modelIndex + 1;
  const terminator = lineTerminator(lines[insertAt - 1]!);
  lines.splice(insertAt, 0, `${key}: ${value}${terminator}`);
  return { ok: true, content: lines.join("") };
}

export function readFrontmatterModel(
  content: string,
): FrontmatterModelReadResult {
  const result = readFrontmatterKey(content, "model");
  if (!result.ok) return result;
  if (result.value === null) return { ok: false, error: "missing_model_key" };
  return { ok: true, model: result.value };
}

export function replaceFrontmatterModel(
  content: string,
  model: string,
): FrontmatterModelWriteResult {
  const current = readFrontmatterModel(content);
  if (!current.ok) return current;
  return upsertFrontmatterKey(content, "model", model);
}
