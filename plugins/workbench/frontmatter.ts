export type FrontmatterModelError = "missing_frontmatter" | "missing_model_key";

export type FrontmatterModelReadResult =
  | { ok: true; model: string }
  | { ok: false; error: FrontmatterModelError };

export type FrontmatterModelWriteResult =
  | { ok: true; content: string }
  | { ok: false; error: FrontmatterModelError };

const LINE_PATTERN = /[^\n]*\n|[^\n]+$/g;
const MODEL_LINE_PATTERN = /^(\s*model\s*:\s*)(.*)$/;

function splitLines(content: string): string[] {
  return content.match(LINE_PATTERN) ?? [];
}

function lineBody(line: string): string {
  return line.replace(/\r?\n$/, "");
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

function findModelLineIndex(
  lines: readonly string[],
  range: { start: number; end: number },
): number | null {
  for (let index = range.start; index < range.end; index += 1) {
    if (MODEL_LINE_PATTERN.test(lineBody(lines[index]!))) return index;
  }
  return null;
}

export function readFrontmatterModel(
  content: string,
): FrontmatterModelReadResult {
  const lines = splitLines(content);
  const range = findFrontmatterRange(lines);
  if (range === null) return { ok: false, error: "missing_frontmatter" };
  const modelIndex = findModelLineIndex(lines, range);
  if (modelIndex === null) return { ok: false, error: "missing_model_key" };
  const match = MODEL_LINE_PATTERN.exec(lineBody(lines[modelIndex]!))!;
  return { ok: true, model: match[2]!.trim() };
}

export function replaceFrontmatterModel(
  content: string,
  model: string,
): FrontmatterModelWriteResult {
  const lines = splitLines(content);
  const range = findFrontmatterRange(lines);
  if (range === null) return { ok: false, error: "missing_frontmatter" };
  const modelIndex = findModelLineIndex(lines, range);
  if (modelIndex === null) return { ok: false, error: "missing_model_key" };
  const line = lines[modelIndex]!;
  const terminator = line.slice(lineBody(line).length);
  const match = MODEL_LINE_PATTERN.exec(lineBody(line))!;
  lines[modelIndex] = `${match[1]}${model}${terminator}`;
  return { ok: true, content: lines.join("") };
}
