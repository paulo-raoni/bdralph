import * as pty from "node-pty";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "../../bin/bdralph");

function spawnInPty(
  args: string[],
  env: Record<string, string>,
  cols: number,
  rows: number,
  collectMs: number
): Promise<string> {
  return new Promise((resolve) => {
    const ptyProcess = pty.spawn("bash", [BIN, ...args], {
      name: "xterm-color",
      cols,
      rows,
      env: { ...process.env, ...env },
    });
    let output = "";
    ptyProcess.onData((data) => { output += data; });
    const timer = setTimeout(() => {
      ptyProcess.kill();
      resolve(output);
    }, collectMs);
    ptyProcess.onExit(() => {
      clearTimeout(timer);
      resolve(output);
    });
  });
}

const MOCK_ENV = {
  BDRALPH_LOOP_MOCK: "1",
  BDRALPH_MOCK_RESULT: "SHIP",
};

describe("Panel responsiveness smoke tests", () => {

  // PANEL-R-01: wide layout (≥120 cols) renders full header
  it("PANEL-R-01: wide layout renders bdralph header", async () => {
    const output = await spawnInPty(
      ["test task", "--max", "1"],
      { ...MOCK_ENV },
      120, 30, 3000
    );
    expect(output).not.toContain("TransformError");
    // Wide layout: full header visible
    expect(output).toMatch(/bdralph/i);
  }, 10000);

  // PANEL-R-02: narrow layout (<80 cols) does not crash
  it("PANEL-R-02: narrow layout renders without error", async () => {
    const output = await spawnInPty(
      ["test task", "--max", "1"],
      { ...MOCK_ENV },
      60, 30, 3000
    );
    expect(output).not.toContain("TransformError");
    expect(output).not.toContain("Top-level await");
  }, 10000);

  // PANEL-R-03: minimalist mode (<15 rows) renders single-line header
  it("PANEL-R-03: minimalist mode renders without crash", async () => {
    const output = await spawnInPty(
      ["test task", "--max", "1"],
      { ...MOCK_ENV },
      80, 10, 3000
    );
    expect(output).not.toContain("TransformError");
    // Should still render something
    expect(output.trim().length).toBeGreaterThan(0);
  }, 10000);

  // PANEL-R-04: medium layout (80-119 cols) renders without error
  it("PANEL-R-04: medium layout renders without error", async () => {
    const output = await spawnInPty(
      ["test task", "--max", "1"],
      { ...MOCK_ENV },
      100, 30, 3000
    );
    expect(output).not.toContain("TransformError");
    expect(output).not.toContain("Top-level await");
  }, 10000);

});
