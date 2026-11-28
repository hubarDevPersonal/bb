// Node 25+ defines its own `localStorage` global (undefined without
// --localstorage-file), which shadows jsdom's. Restore jsdom's storage.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom;
if (dom !== undefined && window.localStorage == null) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: dom.window.localStorage,
  });
}
