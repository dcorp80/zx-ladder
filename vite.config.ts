/// <reference types="vitest" />
/// <reference types="vite/client" />

import { execSync } from "node:child_process";
import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

// Short git SHA at build time. Falls back to "dev" if git isn't
// available (e.g. unpacked tarball) so the global is always a string.
function getBuildSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? "/zx-ladder/" : "/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(getBuildSha()),
  },
  plugins: [solid()],
  server: {
    port: 3000,
    open: false,
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: [
      "node_modules/@testing-library/jest-dom/vitest",
      "src/test/setup.ts",
    ],
    // if you have few tests, try commenting this
    // out to improve performance:
    isolate: false,
  },
  build: {
    target: "esnext",
  },
}));
