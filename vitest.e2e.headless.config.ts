import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/loop/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    hookTimeout: 60000,
    testTimeout: 60000,
    // E2E-L1-07 writes .bdralph.config.json to REPO_ROOT (shared state),
    // so file parallelism must be disabled to avoid cross-test interference.
    fileParallelism: false,
  },
});
