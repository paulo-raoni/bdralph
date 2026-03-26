// ralph-ink.ts — Entry point spawned by ralph-loop.sh.
// Usage: npx tsx ralph-ink.ts <UI_STATE_PREFIX>
//
// Re-exports helpers for testing, and delegates to ralph-ink-panel.tsx for rendering.

export { readStateFile, readWorkerLines, formatCost } from "./ralph-ink-helpers.js";

async function main() {
  const { startPanel } = await import("./ralph-ink-panel.jsx");

  const prefix = process.argv[2];
  if (!prefix) {
    process.stderr.write("Usage: ralph-ink.ts <UI_STATE_PREFIX>\n");
    process.exit(1);
  }

  const budget = process.env.BDRALPH_BUDGET || "0.50";
  const instance = startPanel(prefix, budget);

  const cleanup = () => {
    instance.unmount();
    process.stdout.write("\x1B[2J\x1B[H"); // clear screen
    process.stdout.write("\x1B[?25h"); // restore cursor
    process.exit(0);
  };

  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

// Only run when executed directly (not imported)
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("ralph-ink.ts") ||
    process.argv[1].endsWith("ralph-ink.js"));

if (isMain) {
  main();
}
