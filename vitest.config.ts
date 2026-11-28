import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

// theme.test.ts validates the manifest with bb's own schema when a bb
// checkout is present (BB_REPO, default ~/Dev/bb).
const bbRepo = process.env.BB_REPO ?? join(homedir(), "Dev/bb");

export default defineConfig({
  server: { fs: { allow: [".", bbRepo] } },
  test: {
    environment: "jsdom",
    include: ["*.test.ts", "*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
