import { writeFileSync } from "node:fs";

const [mode, appUrl, candidate] = process.argv.slice(2);
if (!['before', 'after'].includes(mode) || !appUrl || !candidate) {
  throw new Error('Usage: pr2203-qa.mjs <before|after> <app-url> <candidate-sha>');
}

const port = 39225;
const artifactDir = '/Users/brsbl/.bb-machines/brsbl.getbb.app/thread-storage/thr_7mkij6e445/qa';
const screenshotPath = `${artifactDir}/pr2203-${mode}-menu.png`;
const selectedScreenshotPath = `${artifactDir}/pr2203-${mode}-selected.png`;
const resultPath = `${artifactDir}/pr2203-${mode}-result.json`;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) => response.json());
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
const page = targets.find((target) => target.type === 'page');
if (!page) throw new Error('No Chrome page target');

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const consoleProblems = [];
const networkSearches = [];
socket.addEventListener('message', async (event) => {
  const payload = event.data instanceof Blob ? await event.data.text() : event.data;
  const message = JSON.parse(payload);
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleProblems.push({ type: 'exception', text: message.params.exceptionDetails.text });
  }
  if (message.method === 'Runtime.consoleAPICalled') {
    const { type, args } = message.params;
    if (type === 'error' || type === 'warning') {
      consoleProblems.push({
        type,
        text: args.map((argument) => argument.value ?? argument.description ?? '').join(' '),
      });
    }
  }
  if (message.method === 'Log.entryAdded') {
    const entry = message.params.entry;
    if (entry.level === 'error' || entry.level === 'warning') {
      consoleProblems.push({ type: entry.level, text: entry.text, source: entry.source });
    }
  }
  if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/v1/plugins/mentions/search')) {
    try {
      const responseBody = await send('Network.getResponseBody', { requestId: message.params.requestId }, message.sessionId);
      networkSearches.push({ url: message.params.response.url, status: message.params.response.status, body: responseBody.body });
    } catch (error) {
      networkSearches.push({ url: message.params.response.url, status: message.params.response.status, error: String(error) });
    }
  }
});

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
await send('Runtime.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Log.enable', {}, sessionId);
await send('Network.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-color-scheme', value: 'light' }] }, sessionId);

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

async function waitFor(expression, description, timeoutMilliseconds = 20000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return;
    } catch {}
    await sleep(150);
  }
  let diagnostic = null;
  try {
    diagnostic = await evaluate("({ url: location.href, title: document.title, body: document.body?.innerText?.slice(0, 4000), html: document.body?.innerHTML?.slice(0, 2000) })");
  } catch (error) {
    diagnostic = { evaluationError: String(error) };
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify({ diagnostic, consoleProblems })}`);
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
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, button: 'none' }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 }, sessionId);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 }, sessionId);
}

await send('Page.navigate', { url: appUrl }, sessionId);
await waitFor("document.body.innerText.includes('New thread')", 'app first paint', 90000);
const firstPaint = await evaluate("performance.getEntriesByType('paint').map((entry) => ({ name: entry.name, startTime: Math.round(entry.startTime) }))");
await send('Page.reload', { ignoreCache: true }, sessionId);
await waitFor("document.body.innerText.includes('New thread')", 'app after hard reload');
await waitFor("fetch('/api/v1/plugins/contributions').then((response) => response.json()).then((data) => data.mentionProviders?.some((provider) => provider.pluginId === 'at-plugin'))", 'installed mention provider');
await sleep(3000);
await click("Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'New thread' || button.innerText.trim() === 'New thread')", 'New thread button');
await waitFor("Array.from(document.querySelectorAll('[contenteditable=\"true\"], textarea')).some((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })", 'new-thread composer');
await click("Array.from(document.querySelectorAll('[contenteditable=\"true\"], textarea')).find((element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; })", 'new-thread composer');

await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 4 }, sessionId);
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 }, sessionId);
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace' }, sessionId);
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' }, sessionId);
await send('Input.insertText', { text: '@automations' }, sessionId);
await waitFor("(() => { const menu = document.querySelector('[data-promptbox-typeahead-menu]'); return menu && menu.innerText.includes('Installed') && menu.innerText.includes('Projects') && menu.innerText.includes('Schedule recurring') && menu.innerText.includes('Automations project'); })()", 'settled Automations plugin and project results');
await sleep(500);

const menuState = await evaluate(`(() => {
  const menu = document.querySelector('[data-promptbox-typeahead-menu]');
  const text = menu.innerText;
  return {
    text,
    installedIndex: text.indexOf('Installed'),
    projectsIndex: text.indexOf('Projects'),
    automationsIndex: text.indexOf('Automations'),
    projectIndex: text.indexOf('Automations project'),
    buttons: Array.from(menu.querySelectorAll('button')).map((button) => ({
      text: button.innerText.trim(),
      ariaSelected: button.getAttribute('aria-selected'),
      dataSelected: button.getAttribute('data-selected'),
      dataHighlighted: button.getAttribute('data-highlighted'),
    })),
  };
})()`);

if (mode === 'after') {
  if (!(menuState.installedIndex >= 0 && menuState.projectsIndex >= 0 && menuState.installedIndex < menuState.projectsIndex)) {
    throw new Error(`Expected Installed before Projects, received ${menuState.text}`);
  }
  if (!menuState.buttons[0]?.text.startsWith('Automations')) {
    throw new Error(`Expected Automations as first keyboard candidate, received ${JSON.stringify(menuState.buttons)}`);
  }
}

const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId);
writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter' }, sessionId);
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' }, sessionId);
await waitFor("!document.querySelector('[data-promptbox-typeahead-menu]')", 'keyboard selection to close menu');
const selectedText = await evaluate("document.querySelector('[data-promptbox-shell]').innerText");
if (mode === 'after' && !selectedText.includes('Automations')) {
  throw new Error(`Expected keyboard selection to choose Automations, received ${selectedText}`);
}
const selectedScreenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, sessionId);
writeFileSync(selectedScreenshotPath, Buffer.from(selectedScreenshot.data, 'base64'));

await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', modifiers: 4 }, sessionId);
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 }, sessionId);
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace' }, sessionId);
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' }, sessionId);
await sleep(250);
const resetState = {
  text: await evaluate("(() => { const editor = document.querySelector('[data-promptbox-shell] [contenteditable=\"true\"], [data-promptbox-shell] textarea'); return editor?.innerText ?? editor?.value ?? ''; })()"),
  menuVisible: await evaluate("Boolean(document.querySelector('[data-promptbox-typeahead-menu]'))"),
};
if (resetState.text.trim() || resetState.menuVisible) throw new Error(`Prompt reset failed: ${JSON.stringify(resetState)}`);

const result = {
  mode,
  candidate,
  browser: version.Browser,
  viewport: '1440x900',
  theme: 'light',
  route: await evaluate("location.pathname + location.search + location.hash"),
  firstPaint,
  menuState,
  selectedText,
  resetState,
  networkSearches,
  consoleProblems,
  screenshotPath,
  selectedScreenshotPath,
};
writeFileSync(resultPath, JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result, null, 2));

await send('Target.detachFromTarget', { sessionId });
socket.close();
