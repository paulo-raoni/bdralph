import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/loop/**/*.test.ts", "tests/cli/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    hookTimeout: 60000,
    testTimeout: 60000,
    // E2E loop tests use per-test tmpDir isolation — parallel is safe.
    fileParallelism: true,
  },
});
