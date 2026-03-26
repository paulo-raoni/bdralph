import * as pty from "node-pty";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "../../bin/bdralph");

// Helper: spawn bdralph in a pty and collect output for N ms
function spawnInPty(
  args: string[],
  env: Record<string, string>,
  collectMs: number
): Promise<string> {
  return new Promise((resolve) => {
    const ptyProcess = pty.spawn("bash", [BIN, ...args], {
      name: "xterm-color",
      cols: 120,
      rows: 30,
      env: { ...process.env, ...env },
    });
    let output = "";
    ptyProcess.onData((data) => {
      output += data;
    });
    setTimeout(() => {
      ptyProcess.kill();
      resolve(output);
    }, collectMs);
  });
}

describe("Ink panel smoke tests", () => {
  // PANEL-01: Ink panel renders without TransformError
  it("PANEL-01: Ink panel renders without TransformError in mock mode", async () => {
    const output = await spawnInPty(
      ["test task", "--max", "1"],
      {
        BDRALPH_INK_UI: "1",
        BDRALPH_LOOP_MOCK: "1",
        BDRALPH_MOCK_RESULT: "SHIP",
      },
      3000
    );
    expect(output).not.toContain("TransformError");
    expect(output).not.toContain("Top-level await");
  }, 10000);

  // PANEL-02: Panel displays correct fields (mock mode outputs summary, not Ink panel)
  it("PANEL-02: panel displays iteration, model and cost fields", async () => {
    const output = await spawnInPty(
      ["test task", "--max", "1", "--worker", "sonnet"],
      {
        BDRALPH_INK_UI: "1",
        BDRALPH_LOOP_MOCK: "1",
      },
      3000
    );
    expect(output).toContain("iteration 1");
    expect(output).toContain("sonnet");
    expect(output).toContain("$0");
  }, 10000);

  // PANEL-03: Process exits after SHIP without manual intervention
  it("PANEL-03: process exits after SHIP without manual intervention", async () => {
    const exitCode = await new Promise<number>((resolve) => {
      const ptyProcess = pty.spawn("bash", [BIN, "test task", "--max", "1"], {
        name: "xterm-color",
        cols: 120,
        rows: 30,
        env: {
          ...process.env,
          BDRALPH_INK_UI: "1",
          BDRALPH_LOOP_MOCK: "1",
          BDRALPH_MOCK_RESULT: "SHIP",
        },
      });
      ptyProcess.onExit(({ exitCode }) => resolve(exitCode));
      // Timeout failsafe — if it doesn't exit in 10s, kill and fail
      setTimeout(() => {
        ptyProcess.kill();
        resolve(999);
      }, 10000);
    });
    expect(exitCode).toBe(0);
  }, 15000);

  // PANEL-04: BDRALPH_NO_UI=1 does not render Ink panel
  it("PANEL-04: BDRALPH_NO_UI=1 does not render Ink panel", async () => {
    const output = await spawnInPty(
      ["test task", "--max", "1"],
      {
        BDRALPH_NO_UI: "1",
        BDRALPH_LOOP_MOCK: "1",
        BDRALPH_MOCK_RESULT: "SHIP",
      },
      3000
    );
    expect(output).not.toMatch(/Iter\s+\d+\s*\/\s*\d+/);
    expect(output).toContain("SHIPPED");
  }, 10000);
});
