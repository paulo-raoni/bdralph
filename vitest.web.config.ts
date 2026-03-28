import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/web/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: 15_000,
    testTimeout: 10_000,
  },
});
