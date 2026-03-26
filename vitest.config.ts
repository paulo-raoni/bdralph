import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["fixtures/**", "tests/e2e/**"],
    fileParallelism: false,
  },
});
