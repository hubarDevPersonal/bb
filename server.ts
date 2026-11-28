import type { BbPluginApi } from "@get-bb/plugin-sdk";

// Festive is frontend-only: everything lives in app.tsx. BB requires a
// backend entry, so this one only logs that the plugin loaded.
export default function festive(bb: BbPluginApi) {
  bb.log.info("Festive loaded");
}
