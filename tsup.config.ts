import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
  },
  {
    // The CLI is ESM-only (it uses import.meta to find the bundled skill).
    entry: { cli: "src/cli/main.ts" },
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    clean: false,
  },
]);
