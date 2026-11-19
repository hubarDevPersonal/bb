# Built-in browser automation

`bb browser` is the experimental core API for automation integrations controlling BB desktop tabs. The bundled Browser Automation plugin adds its own `bb browser-automation` session commands (see its browser-automation skill); another plugin can use the same core connection independently.

Start with `bb browser instances --host <host-id> --json`. For every tab/control operation provide `--host <host-id> --instance <instance-id> --generation <generation> --thread <thread-id>`. The browser host can differ from the agent host. Never infer an active desktop window; only `bb artifact open` below picks one, and only when exactly one is connected.

- `tabs`: list native tabs and their control state.
- `create [--url <http(s)-url>] [--reveal]`: create a tab in the BB browser profile, with the user's signed-in cookies. Defaults: hidden, about:blank.
- `acquire <tab-ids...> --controller <label> [--ttl-ms <ms>]`: acquire exclusive tab control. It reveals the first tab only when the owning thread is already focused; it never switches threads or activates a desktop window. Default expiry is five minutes, maximum thirty minutes. Controlled tabs carry the BB browser profile's signed-in authority.
- `connection <lease-id> --output <new-file>`: write private connection JSON with mode 0600 on the CLI host. The loopback WebSocket endpoint is usable only on the browser host. Pass it privately to an integration worker; never expose it through a shared port or chat output.
- `release <lease-id>`: revoke automation while keeping tabs open.
- `reveal <tab-id>`: open the side panel and select the existing native tab only if its thread is already focused; otherwise leave the current view unchanged.
- `capture <tab-id> --output <new-file>`: save a bounded JPEG to the CLI host without focusing the tab.
- `close <tab-id>`: explicitly close that native tab.
- `watch`: print changed tab snapshots every two seconds until interrupted. Disconnects report errors; this is not a lossless event log.

Claude artifacts: `bb artifact open <url> [--thread <id>] [--host <id>] [--instance <id>]` opens a `https://claude.ai/artifact/<id>`, `https://claude.ai/code/artifact/<id>`, or `https://claude.ai/public/artifacts/<id>` URL in a new tab of the BB browser profile, which keeps the claude.ai login. The tab is shown only if its thread is already focused in that window. The thread defaults to `BB_THREAD_ID`. Without `--host` and `--instance` it uses the only connected desktop window and fails when there are several (listing them) or none (naming hosts that could not be queried). Other URLs are refused. In the desktop app, clicking such a link always opens it in a bb browser tab, even with "Open links in bb" off.

Cookie import copies signed-in sessions from a browser installed on the desktop host into the BB browser profile. These two commands take `--host`, `--instance`, and `--generation` but no `--thread`:

- `import-sources`: combine known-browser entries (Chrome, Chromium, Helium (macOS), Edge, Brave, Vivaldi, Opera, Arc (macOS), Dia (macOS), Firefox, Zen, Safari (macOS)) with automatically detected Chromium/Firefox cookie stores, their profiles with cookie counts, and why one is unavailable (`notInstalled`, `browserRunning`, `needsFullDiskAccess`, `needsKeychainApproval`, `unsupportedPlatform`).
- `import-cookies --from <source-id> --profile <directory>`: read that profile's cookie store and write it into the BB browser profile. The source browser must be quit first. macOS prompts for Keychain access for Chromium browsers and needs Full Disk Access for Safari. The result reports imported and skipped counts plus skipped hosts; `ok: false` carries a reason. A one-time copy, never a sync; partitioned cookies and non-default Firefox containers are skipped. Desktop only (macOS and Linux). Use the exact source ID returned by `import-sources`; additional stores have stable opaque `storage-…` IDs.

Discovery finds known browsers plus other Chromium and Firefox cookie stores in standard per-user locations, including Flatpak and Snap; it reads no encryption secrets and excludes BB's own desktop profile. Arbitrary custom locations, other cookie formats, and custom encryption are not supported. Refresh rescans.

All commands support JSON output. In plugin code use `bb.sdk.experimental_desktopBrowsers`; the Plugin Guide documents the typed surface. Stop/Take over revokes native control; stopping the owning thread also releases its server control leases. Old connection generations cannot control replacement windows.

Cloud browsers are not supported. Headless Chrome on an enrolled host belongs to the Browser Automation plugin.
