import { readFileSync, writeFileSync } from "node:fs";

const port = 39226;
const appUrl = "http://localhost:15778/";
const artifactDir = "/Users/brsbl/.bb-machines/brsbl.getbb.app/thread-storage/thr_7mkij6e445/qa";
const matrix = JSON.parse(
  readFileSync(`${artifactDir}/pr2203-fixtures/matrix.json`, "utf8"),
);
const requestedCaseIds = process.argv.slice(2);
const selectedCases =
  requestedCaseIds.length === 0
    ? matrix.cases
    : matrix.cases.filter((fixtureCase) =>
        requestedCaseIds.includes(fixtureCase.id),
      );
if (selectedCases.length !== (requestedCaseIds.length || matrix.cases.length)) {
  throw new Error("Unknown or duplicate fixture case id");
}
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(
  (response) => response.json(),
);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
  (response) => response.json(),
);
const page = targets.find((target) => target.type === "page");
if (!page) throw new Error("No Chrome page target");

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const consoleProblems = [];
socket.addEventListener("message", async (event) => {
  const payload = event.data instanceof Blob ? await event.data.text() : event.data;
  const message = JSON.parse(payload);
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    consoleProblems.push({
      type: "exception",
      text: message.params.exceptionDetails.text,
    });
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const { type, args } = message.params;
    if (type === "error" || type === "warning") {
      consoleProblems.push({
        type,
        text: args
          .map((argument) => argument.value ?? argument.description ?? "")
          .join(" "),
      });
    }
  }
  if (message.method === "Log.entryAdded") {
    const entry = message.params.entry;
    if (entry.level === "error" || entry.level === "warning") {
      consoleProblems.push({
        type: entry.level,
        text: entry.text,
        source: entry.source,
      });
    }
  }
});

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }),
    );
  });
}

const { sessionId } = await send("Target.attachToTarget", {
  targetId: page.id,
  flatten: true,
});
await send("Runtime.enable", {}, sessionId);
await send("Page.enable", {}, sessionId);
await send("Log.enable", {}, sessionId);
await send("Network.enable", {}, sessionId);
await send(
  "Emulation.setDeviceMetricsOverride",
  {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  },
  sessionId,
);
await send(
  "Emulation.setEmulatedMedia",
  {
    media: "screen",
    features: [{ name: "prefers-color-scheme", value: "light" }],
  },
  sessionId,
);

async function evaluate(expression) {
  const response = await send(
    "Runtime.evaluate",
    { expression, returnByValue: true, awaitPromise: true },
    sessionId,
  );
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function waitFor(expression, description, timeoutMilliseconds = 30000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return;
    } catch {}
    await sleep(150);
  }
  const diagnostic = await evaluate(
    "({ url: location.href, body: document.body?.innerText?.slice(0, 5000) })",
  );
  throw new Error(
    `Timed out waiting for ${description}: ${JSON.stringify(diagnostic)}`,
  );
}

async function click(expression, description) {
  const target = await evaluate(`(() => {
    const element = ${expression};
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!target) throw new Error(`Could not find ${description}`);
  await send(
    "Input.dispatchMouseEvent",
    { type: "mouseMoved", x: target.x, y: target.y, button: "none" },
    sessionId,
  );
  await send(
    "Input.dispatchMouseEvent",
    {
      type: "mousePressed",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1,
    },
    sessionId,
  );
  await send(
    "Input.dispatchMouseEvent",
    {
      type: "mouseReleased",
      x: target.x,
      y: target.y,
      button: "left",
      clickCount: 1,
    },
    sessionId,
  );
}

async function clearComposer() {
  await click(
    "Array.from(document.querySelectorAll('[data-promptbox-shell] [contenteditable=\"true\"], [data-promptbox-shell] textarea')).find((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })",
    "composer editor",
  );
  await send(
    "Input.dispatchKeyEvent",
    { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 4 },
    sessionId,
  );
  await send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", key: "a", code: "KeyA", modifiers: 4 },
    sessionId,
  );
  await send(
    "Input.dispatchKeyEvent",
    { type: "rawKeyDown", key: "Backspace", code: "Backspace" },
    sessionId,
  );
  await send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", key: "Backspace", code: "Backspace" },
    sessionId,
  );
  await sleep(200);
}

function assertEqual(actual, expected, description) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${description}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

await send("Page.navigate", { url: appUrl }, sessionId);
await waitFor(
  "document.body.innerText.includes('New thread')",
  "app first paint",
  90000,
);
const firstPaint = await evaluate(
  "performance.getEntriesByType('paint').map((entry) => ({ name: entry.name, startTime: Math.round(entry.startTime) }))",
);
await send("Page.reload", { ignoreCache: true }, sessionId);
await waitFor(
  "document.body.innerText.includes('New thread')",
  "app after hard reload",
  90000,
);
await waitFor(
  "fetch('/api/v1/plugins/contributions').then((response) => response.json()).then((data) => data.mentionProviders?.some((provider) => provider.pluginId === 'at-plugin'))",
  "installed mention provider",
);
await sleep(3000);
await click(
  "Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'New thread' || button.innerText.trim() === 'New thread')",
  "New thread button",
);
await waitFor(
  "Array.from(document.querySelectorAll('[data-promptbox-shell] [contenteditable=\"true\"], [data-promptbox-shell] textarea')).some((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })",
  "new-thread composer",
);

const projectSourceOrder = await evaluate(
  "fetch('/api/v1/projects').then((response) => response.json()).then((projects) => projects.map((project) => project.name))",
);
const caseResults = [];

for (const fixtureCase of selectedCases) {
  const expectedRows = fixtureCase.expectedRowsFromSourceOrder
    ? projectSourceOrder.filter((name) =>
        name.toLowerCase().startsWith(fixtureCase.query.slice(1).toLowerCase()),
      )
    : fixtureCase.expectedRows;
  const expectedSelection = fixtureCase.expectedKeyboardSelectionFromSourceOrder
    ? expectedRows[0]
    : fixtureCase.expectedKeyboardSelection;
  if (expectedRows.length === 0 || !expectedSelection) {
    throw new Error(`Fixture ${fixtureCase.id} has no expected first row`);
  }

  await clearComposer();
  await send("Input.insertText", { text: fixtureCase.query }, sessionId);
  await waitFor(
    `(() => {
      const menu = document.querySelector('[data-promptbox-typeahead-menu]');
      if (!menu) return false;
      const titles = Array.from(menu.querySelectorAll('button')).map((button) => button.innerText.trim().split('\\n')[0]);
      return ${JSON.stringify(expectedRows)}.every((title) => titles.includes(title));
    })()`,
    `${fixtureCase.id} expected rows`,
  );
  await sleep(2000);

  const menuState = await evaluate(`(() => {
    const menu = document.querySelector('[data-promptbox-typeahead-menu]');
    const text = menu.innerText;
    return {
      text,
      groupLabels: ${JSON.stringify(fixtureCase.expectedGroups)}
        .slice()
        .sort((left, right) => text.indexOf(left) - text.indexOf(right)),
      rows: Array.from(menu.querySelectorAll('button')).map((button) => ({
        title: button.innerText.trim().split('\\n')[0],
        text: button.innerText.trim(),
      })),
    };
  })()`);
  assertEqual(
    menuState.groupLabels,
    fixtureCase.expectedGroups,
    `${fixtureCase.id} group order`,
  );
  assertEqual(
    menuState.rows.map((row) => row.title),
    expectedRows,
    `${fixtureCase.id} row order`,
  );

  const screenshotPath = `${artifactDir}/pr2203-fixture-${fixtureCase.id}.png`;
  const screenshot = await send(
    "Page.captureScreenshot",
    { format: "png", fromSurface: true, captureBeyondViewport: false },
    sessionId,
  );
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await send(
    "Input.dispatchKeyEvent",
    { type: "rawKeyDown", key: "Enter", code: "Enter" },
    sessionId,
  );
  await send(
    "Input.dispatchKeyEvent",
    { type: "keyUp", key: "Enter", code: "Enter" },
    sessionId,
  );
  await waitFor(
    "!document.querySelector('[data-promptbox-typeahead-menu]')",
    `${fixtureCase.id} keyboard selection`,
  );
  const selectedText = await evaluate(
    "document.querySelector('[data-promptbox-shell]').innerText",
  );
  if (!selectedText.includes(expectedSelection)) {
    throw new Error(
      `${fixtureCase.id} expected Enter to select ${expectedSelection}, received ${selectedText}`,
    );
  }

  await clearComposer();
  const resetState = {
    text: await evaluate(
      "(() => { const editor = document.querySelector('[data-promptbox-shell] [contenteditable=\"true\"], [data-promptbox-shell] textarea'); return editor?.innerText ?? editor?.value ?? ''; })()",
    ),
    menuVisible: await evaluate(
      "Boolean(document.querySelector('[data-promptbox-typeahead-menu]'))",
    ),
  };
  if (resetState.text.trim() || resetState.menuVisible) {
    throw new Error(
      `${fixtureCase.id} clear/reset failed: ${JSON.stringify(resetState)}`,
    );
  }

  caseResults.push({
    id: fixtureCase.id,
    query: fixtureCase.query,
    groups: menuState.groupLabels,
    rows: menuState.rows,
    keyboardSelection: expectedSelection,
    resetState,
    screenshotPath,
    result: "PASS",
  });
}

const runtimeErrors = consoleProblems.filter(
  (problem) => problem.type === "error" || problem.type === "exception",
);
if (runtimeErrors.length > 0) {
  throw new Error(`Runtime errors: ${JSON.stringify(runtimeErrors)}`);
}

const result = {
  candidate: matrix.candidate,
  browser: version.Browser,
  viewport: matrix.viewport,
  theme: "light",
  route: await evaluate("location.pathname + location.search + location.hash"),
  firstPaint,
  projectSourceOrder,
  cases: caseResults,
  runtimeErrors,
  warnings: consoleProblems.filter((problem) => problem.type === "warning"),
  result: "PASS",
};
const resultSuffix =
  requestedCaseIds.length === 0 ? "result" : `${requestedCaseIds.join("-")}-result`;
writeFileSync(
  `${artifactDir}/pr2203-fixture-matrix-${resultSuffix}.json`,
  JSON.stringify(result, null, 2),
);
process.stdout.write(JSON.stringify(result, null, 2));

await send("Target.detachFromTarget", { sessionId });
socket.close();
