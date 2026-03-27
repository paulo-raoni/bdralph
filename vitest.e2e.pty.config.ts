import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/panel/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    hookTimeout: 60000,
    testTimeout: 60000,
    // PTY tests are isolated by tmpDir — but run sequentially to avoid
    // multiple PTY processes competing for /dev/tty simultaneously.
    fileParallelism: false,
  },
});
