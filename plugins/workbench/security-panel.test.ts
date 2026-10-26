import { describe, expect, it } from "vitest";
import {
  buildSecuritySystemPrompt,
  buildSecurityUserPrompt,
  extractJsonObject,
  fetchSecurityCatalog,
  mergeSecurityFindings,
  parseModelFindings,
  parseSecurityBaseUrl,
  parseSecurityModels,
  renderSecurityReport,
  retryWaitMs,
  runSecurityPanel,
  securityCostUsd,
  type SecurityCatalogEntry,
  type SecurityFetch,
  type SecurityFinding,
  type SecurityModelRun,
  type SecurityPanelRequest,
} from "./security-panel.js";

const API_KEY = "sk-test-secret-key-123";
const BASE_URL = "https://gateway.test/v1";

function finding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    severity: "error",
    specId: "SEC-3",
    file: "src/api.ts",
    line: 10,
    title: "Unsanitized SQL query built from request body",
    exploit: "POST /items with a crafted name",
    fix: "Use a parameterized query",
    confidence: "medium",
    ...overrides,
  };
}

function run(
  model: string,
  findings: SecurityFinding[],
  ok = true,
): SecurityModelRun {
  return {
    model,
    ok,
    error: ok ? null : "boom",
    structured: true,
    findings,
    promptTokens: null,
    completionTokens: null,
    costUsd: null,
    durationMs: 0,
    raw: null,
  };
}

function catalogEntry(
  id: string,
  overrides: Partial<SecurityCatalogEntry> = {},
): SecurityCatalogEntry {
  return {
    id,
    supports_structured_output: true,
    supported_reasoning_efforts: ["low", "medium", "high"],
    context_window_tokens: 1_000_000,
    pricing: {
      input_nano_usd_per_million_tokens: 100_000_000,
      output_nano_usd_per_million_tokens: 500_000_000,
      cached_input_nano_usd_per_million_tokens: 10_000_000,
    },
    ...overrides,
  };
}

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    text: async () => text,
  };
}

function completion(
  content: string,
  usage = { prompt: 1000, completion: 500 },
) {
  return response(200, {
    choices: [{ message: { content } }],
    usage: {
      prompt_tokens: usage.prompt,
      completion_tokens: usage.completion,
    },
  });
}

interface RecordedCall {
  url: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

function panelRequest(
  fetchImpl: SecurityFetch,
  overrides: Partial<SecurityPanelRequest> = {},
): SecurityPanelRequest {
  return {
    fetch: fetchImpl,
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    signal: null,
    models: ["model-a"],
    catalog: new Map([["model-a", catalogEntry("model-a")]]),
    reasoningEffort: "medium",
    systemPrompt: "system",
    userPrompt: "user",
    timeoutMs: 5_000,
    retryDelayMs: 0,
    now: () => 0,
    random: () => 0,
    ...overrides,
  };
}

function recordingFetch(
  handler: (call: RecordedCall) => ReturnType<typeof response>,
): { fetch: SecurityFetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = {
        url,
        headers: init.headers,
        body:
          init.body === undefined
            ? null
            : (JSON.parse(init.body) as Record<string, unknown>),
      };
      calls.push(call);
      return handler(call);
    },
  };
}

describe("security panel settings", () => {
  it("accepts an https base URL and strips trailing slashes", () => {
    expect(parseSecurityBaseUrl("https://api.example.com/v1/")).toEqual({
      ok: true,
      baseUrl: "https://api.example.com/v1",
    });
  });

  it("rejects non-https, credentialed, and malformed base URLs", () => {
    for (const value of [
      "http://api.example.com/v1",
      "https://user:pass@api.example.com/v1",
      "https://api.example.com/v1?x=1",
      "file:///etc/passwd",
      "not a url",
    ]) {
      const result = parseSecurityBaseUrl(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("https://");
    }
  });

  it("parses the comma-separated model list, deduplicating and dropping invalid ids", () => {
    expect(
      parseSecurityModels(
        " gpt-6-luna, grok-4.7 ,,gpt-6-luna, bad id, glm-5.3",
      ),
    ).toEqual(["gpt-6-luna", "grok-4.7", "glm-5.3"]);
  });
});

describe("security panel response parsing", () => {
  it("parses a structured JSON response", () => {
    const content = JSON.stringify({ findings: [finding()] });
    expect(parseModelFindings(content)).toEqual({
      ok: true,
      findings: [finding()],
    });
  });

  it("extracts the first JSON object from prose and fences, normalizing case and line strings", () => {
    const content =
      'Here you go:\n```json\n{"findings":[{"severity":"Critical","specId":"SEC-1","file":"a.ts","line":"7","title":"Leak {key}","exploit":"x","fix":"y","confidence":"HIGH"}]}\n```\nDone {not json}';
    expect(parseModelFindings(content)).toEqual({
      ok: true,
      findings: [
        {
          severity: "critical",
          specId: "SEC-1",
          file: "a.ts",
          line: 7,
          title: "Leak {key}",
          exploit: "x",
          fix: "y",
          confidence: "high",
        },
      ],
    });
  });

  it("accepts an empty findings list and a missing line", () => {
    expect(parseModelFindings('{"findings":[]}')).toEqual({
      ok: true,
      findings: [],
    });
    const { line: _line, ...withoutLine } = finding();
    const parsed = parseModelFindings(
      JSON.stringify({ findings: [withoutLine] }),
    );
    expect(parsed).toMatchObject({ ok: true, findings: [{ line: null }] });
  });

  it("reports a schema mismatch or a response without JSON", () => {
    expect(
      parseModelFindings('{"findings":[{"severity":"info"}]}'),
    ).toMatchObject({ ok: false });
    expect(parseModelFindings("No issues found.")).toEqual({
      ok: false,
      error: "response contains no JSON object",
    });
  });

  it("matches braces inside strings when extracting", () => {
    expect(extractJsonObject('x {"a":"}{","b":{"c":1}} y')).toBe(
      '{"a":"}{","b":{"c":1}}',
    );
  });
});

describe("security panel cost", () => {
  it("prices prompt, cached, and completion tokens from nano-USD per million", () => {
    const pricing = catalogEntry("m").pricing;
    expect(
      securityCostUsd(
        { promptTokens: 1000, completionTokens: 500, cachedTokens: 0 },
        pricing,
      ),
    ).toBeCloseTo(0.00035, 10);
    expect(
      securityCostUsd(
        { promptTokens: 1000, completionTokens: 0, cachedTokens: 1000 },
        pricing,
      ),
    ).toBeCloseTo(0.00001, 10);
  });

  it("returns null when the catalog has no pricing", () => {
    expect(
      securityCostUsd(
        { promptTokens: 1, completionTokens: 1, cachedTokens: 0 },
        null,
      ),
    ).toBeNull();
  });
});

describe("security panel merge", () => {
  it("merges the same file, nearby line, and spec across models with k/N consensus", () => {
    const merged = mergeSecurityFindings([
      run("a", [finding({ line: 10, severity: "warning" })]),
      run("b", [finding({ file: "./src/api.ts", line: 12 })]),
      run("c", []),
      run("d", [], false),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      file: "src/api.ts",
      severity: "error",
      models: ["a", "b"],
      consensus: "2/3",
    });
  });

  it("merges a similar title under a different spec id and keeps distant lines apart", () => {
    const merged = mergeSecurityFindings([
      run("a", [finding({ specId: "SEC-3" })]),
      run("b", [
        finding({
          specId: "SEC-4",
          title: "SQL query built from request body unsanitized",
        }),
        finding({ line: 80, specId: "SEC-1", title: "Secret logged" }),
      ]),
    ]);
    expect(merged.map((entry) => entry.consensus)).toEqual(["2/2", "1/2"]);
  });

  it("keeps distinct line-less findings in one file and spec apart, merging only similar titles", () => {
    const merged = mergeSecurityFindings([
      run("a", [
        finding({ line: null, title: "Missing CSRF token on settings form" }),
        finding({ line: null, title: "Session cookie lacks HttpOnly flag" }),
      ]),
      run("b", [
        finding({ line: 40, title: "Settings form missing CSRF token" }),
      ]),
    ]);
    expect(merged).toHaveLength(2);
    expect(
      merged.map((entry) => [entry.title, entry.consensus, entry.line]),
    ).toEqual([
      ["Missing CSRF token on settings form", "2/2", 40],
      ["Session cookie lacks HttpOnly flag", "1/2", null],
    ]);
  });

  it("sorts by severity, then consensus", () => {
    const merged = mergeSecurityFindings([
      run("a", [
        finding({ file: "w.ts", severity: "warning" }),
        finding({ file: "e.ts", severity: "error" }),
        finding({ file: "c.ts", severity: "critical" }),
      ]),
      run("b", [finding({ file: "e2.ts", severity: "error" })]),
      run("c", [finding({ file: "e2.ts", severity: "error" })]),
    ]);
    expect(merged.map((entry) => entry.file)).toEqual([
      "c.ts",
      "e2.ts",
      "e.ts",
      "w.ts",
    ]);
  });
});

describe("security panel prompts", () => {
  it("embeds the security and project specs and treats the diff as untrusted", () => {
    const prompt = buildSecuritySystemPrompt({
      securitySpec: "SEC-1 secrets",
      projectSpec: "PRJ-C1 no comments",
    });
    expect(prompt).toContain("SEC-1 secrets");
    expect(prompt).toContain("PRJ-C1 no comments");
    expect(prompt).toContain("untrusted data");
  });

  it("marks a truncated diff in the user prompt", () => {
    const prompt = buildSecurityUserPrompt({
      diffCommand: "git diff HEAD",
      diff: "+x",
      truncated: true,
      files: ["a.ts"],
      untracked: ["a.ts"],
    });
    expect(prompt).toContain("TRUNCATED");
    expect(prompt).toContain("plus untracked files");
    expect(prompt).toContain("<diff>\n+x\n</diff>");
  });
});

describe("security panel client", () => {
  it("requests structured output and the reasoning effort only where the catalog supports them", async () => {
    const { fetch, calls } = recordingFetch(() =>
      completion(JSON.stringify({ findings: [finding()] })),
    );
    const result = await runSecurityPanel(
      panelRequest(fetch, {
        models: ["structured", "plain"],
        catalog: new Map([
          ["structured", catalogEntry("structured")],
          [
            "plain",
            catalogEntry("plain", {
              supports_structured_output: false,
              supported_reasoning_efforts: ["high"],
            }),
          ],
        ]),
      }),
    );
    const structured = calls.find((call) => call.body?.model === "structured");
    const plain = calls.find((call) => call.body?.model === "plain");
    expect(structured?.url).toBe(`${BASE_URL}/chat/completions`);
    expect(structured?.body).toMatchObject({
      reasoning_effort: "medium",
      response_format: {
        type: "json_schema",
        json_schema: { name: "security_findings", strict: true },
      },
    });
    expect(plain?.body).not.toHaveProperty("response_format");
    expect(plain?.body).not.toHaveProperty("reasoning_effort");
    expect(result.answered).toBe(2);
    expect(result.merged[0]).toMatchObject({ consensus: "2/2" });
    expect(result.promptTokens).toBe(2000);
    expect(result.completionTokens).toBe(1000);
    expect(result.costUsd).toBeCloseTo(0.0007, 10);
  });

  it("reports a model missing from the catalog without calling it", async () => {
    const { fetch, calls } = recordingFetch(() =>
      completion('{"findings":[]}'),
    );
    const result = await runSecurityPanel(
      panelRequest(fetch, { models: ["model-a", "ghost"] }),
    );
    expect(calls.map((call) => call.body?.model)).toEqual(["model-a"]);
    expect(result.models[1]).toMatchObject({
      model: "ghost",
      ok: false,
      error: "not in catalog",
    });
    expect(result.answered).toBe(1);
  });

  it("waits Retry-After seconds or an HTTP date, plus jitter, capped at 30 s", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(retryWaitMs("3", 2_000, now, () => 0)).toBe(3_000);
    expect(retryWaitMs("3", 2_000, now, () => 0.5)).toBe(4_000);
    expect(
      retryWaitMs("Mon, 26 Oct 2026 12:00:10 GMT", 2_000, now, () => 0),
    ).toBe(10_000);
    expect(retryWaitMs("3600", 2_000, now, () => 0)).toBe(30_000);
    expect(retryWaitMs(null, 2_000, now, () => 0.25)).toBe(2_500);
    expect(retryWaitMs("soon", 2_000, now, () => 0)).toBe(2_000);
  });

  it("retries once on 429 and gives up after a second 5xx", async () => {
    let attempts = 0;
    const retried = await runSecurityPanel(
      panelRequest(
        recordingFetch(() => {
          attempts += 1;
          return attempts === 1
            ? response(429, "slow down", { "retry-after": "0" })
            : completion('{"findings":[]}');
        }).fetch,
      ),
    );
    expect(attempts).toBe(2);
    expect(retried.models[0]).toMatchObject({ ok: true });

    let failures = 0;
    const failed = await runSecurityPanel(
      panelRequest(
        recordingFetch(() => {
          failures += 1;
          return response(503, "unavailable");
        }).fetch,
      ),
    );
    expect(failures).toBe(2);
    expect(failed.models[0]).toMatchObject({
      ok: false,
      error: "HTTP 503: unavailable",
    });
  });

  it("times out one model without failing the others", async () => {
    const fetch: SecurityFetch = (_url, init) => {
      const body = JSON.parse(init.body ?? "{}") as { model: string };
      if (body.model === "fast") {
        return Promise.resolve(completion('{"findings":[]}'));
      }
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new Error("aborted")),
        );
      });
    };
    const result = await runSecurityPanel(
      panelRequest(fetch, {
        models: ["slow", "fast"],
        catalog: new Map([
          ["slow", catalogEntry("slow")],
          ["fast", catalogEntry("fast")],
        ]),
        timeoutMs: 20,
      }),
    );
    expect(result.models[0]).toMatchObject({ model: "slow", ok: false });
    expect(result.models[0]!.error).toContain("timed out");
    expect(result.models[1]).toMatchObject({ model: "fast", ok: true });
  });

  it("refuses a prompt larger than the model's context window", async () => {
    const { fetch, calls } = recordingFetch(() =>
      completion('{"findings":[]}'),
    );
    const result = await runSecurityPanel(
      panelRequest(fetch, {
        catalog: new Map([
          ["model-a", catalogEntry("model-a", { context_window_tokens: 1 })],
        ]),
      }),
    );
    expect(calls).toHaveLength(0);
    expect(result.models[0]!.error).toContain("context window");
  });

  it("refuses gateway redirects and reports one as that model's error", async () => {
    const redirects: string[] = [];
    const result = await runSecurityPanel(
      panelRequest(async (_url, init) => {
        redirects.push(init.redirect);
        throw new TypeError("fetch failed", {
          cause: new Error("unexpected redirect"),
        });
      }),
    );
    expect(redirects).toEqual(["error"]);
    expect(result.models[0]).toMatchObject({
      ok: false,
      error: "request failed: fetch failed: unexpected redirect",
    });
  });

  it("keeps an unparseable answer as a model error with its raw content", async () => {
    const { fetch } = recordingFetch(() => completion("I could not decide."));
    const result = await runSecurityPanel(panelRequest(fetch));
    expect(result.models[0]).toMatchObject({
      ok: false,
      error: "response contains no JSON object",
      raw: "I could not decide.",
    });
    expect(result.answered).toBe(0);
  });

  it("never puts the API key into an error, even when the gateway echoes it", async () => {
    const echoed = await runSecurityPanel(
      panelRequest(
        recordingFetch(() =>
          response(
            401,
            `invalid key ${API_KEY} for Authorization: Bearer ${API_KEY}`,
          ),
        ).fetch,
      ),
    );
    const thrown = await runSecurityPanel(
      panelRequest(async () => {
        throw new Error(`connect failed with ${API_KEY}`);
      }),
    );
    const catalog = await fetchSecurityCatalog({
      fetch: async () => response(403, `forbidden ${API_KEY}`),
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      signal: null,
    });
    const errors = [
      echoed.models[0]!.error,
      thrown.models[0]!.error,
      catalog.ok ? "" : catalog.error,
    ];
    for (const error of errors) {
      expect(error).toContain("[redacted]");
      expect(error).not.toContain(API_KEY);
    }
  });

  it("sends the key only as a bearer header and reads the catalog", async () => {
    const { fetch, calls } = recordingFetch(() =>
      response(200, {
        data: [
          {
            id: "gpt-6-luna",
            supports_structured_output: true,
            supported_reasoning_efforts: ["low", "medium"],
            context_window_tokens: 1_050_000,
            pricing: {
              input_nano_usd_per_million_tokens: 100_000_000,
              output_nano_usd_per_million_tokens: 500_000_000,
              cached_input_nano_usd_per_million_tokens: 10_000_000,
            },
          },
          { broken: true },
        ],
      }),
    );
    const catalog = await fetchSecurityCatalog({
      fetch,
      baseUrl: BASE_URL,
      apiKey: API_KEY,
      signal: null,
    });
    expect(calls[0]!.url).toBe(`${BASE_URL}/models`);
    expect(calls[0]!.headers.Authorization).toBe(`Bearer ${API_KEY}`);
    expect(catalog.ok && [...catalog.catalog.keys()]).toEqual(["gpt-6-luna"]);
  });
});

describe("security panel report", () => {
  it("renders the scope, per-model status and cost, and the merged table", () => {
    const report = renderSecurityReport(
      {
        diffCommand: "git diff main...feature",
        files: ["src/api.ts"],
        untracked: [],
        skipped: [".env (secret-like name)"],
        diffChars: 1234,
        truncated: false,
        maxDiffChars: 400_000,
      },
      {
        models: [
          {
            ...run("a", [finding()]),
            promptTokens: 1000,
            completionTokens: 500,
            costUsd: 0.00035,
          },
          run("b", [], false),
        ],
        merged: mergeSecurityFindings([run("a", [finding()])]),
        answered: 1,
        promptTokens: 1000,
        completionTokens: 500,
        costUsd: 0.00035,
        knownCostUsd: 0.00035,
        costUnknownModels: [],
      },
      "/tmp/report.json",
    );
    expect(report).toContain("Scope: `git diff main...feature` · 1 files");
    expect(report).toContain(
      "Withheld from the panel (not sent): .env (secret-like name)",
    );
    expect(report).toContain("| a | ok | 1 | 1000/500 | $0.000350 |");
    expect(report).toContain("| b | error: boom | — | — | — |");
    expect(report).toContain("total $0.000350");
    expect(report).toContain("| 1 | error | SEC-3 | src/api.ts:10 | 1/1 (a) |");
    expect(report).toContain("Full JSON: /tmp/report.json");
  });

  it("shows a known-cost subtotal and names the models whose cost is unknown", async () => {
    const { fetch } = recordingFetch(() => completion('{"findings":[]}'));
    const result = await runSecurityPanel(
      panelRequest(fetch, {
        models: ["priced", "unpriced"],
        catalog: new Map([
          ["priced", catalogEntry("priced")],
          ["unpriced", catalogEntry("unpriced", { pricing: null })],
        ]),
      }),
    );
    expect(result.costUsd).toBeNull();
    expect(result.knownCostUsd).toBeCloseTo(0.00035, 10);
    expect(result.costUnknownModels).toEqual(["unpriced"]);
    const report = renderSecurityReport(
      {
        diffCommand: "git diff HEAD",
        files: [],
        untracked: [],
        skipped: [],
        diffChars: 1,
        truncated: false,
        maxDiffChars: 400_000,
      },
      result,
      null,
    );
    expect(report).toContain("known cost $0.000350, unknown for unpriced");
    expect(report).not.toContain("total $");
  });
});
