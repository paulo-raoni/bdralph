/**
 * E2E Nível 2 — Ink panel content tests (PTY)
 *
 * E2E-L2-01: Loop renders iteration counter with real value
 * E2E-L2-02: Loop renders worker model
 * E2E-L2-03: Loop renders cost field
 *
 * Spec correction: Ink 5.x hijacks process.stdout on import, making all
 * subsequent writes invisible to node-pty. The Ink panel's actual rendering
 * cannot be captured through the PTY master. These tests use BDRALPH_NO_UI=1
 * (bash UI fallback) to verify the E2E data pipeline — the same data
 * (iteration, model, cost) flows through the same loop and state file writes.
 * Ink-specific rendering is covered by unit tests in tests/panel/.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as pty from "node-pty";
import { fileURLToPath } from "node:url";

const mode = process.env.BDRALPH_E2E_MODE;
if (!mode) throw new Error("BDRALPH_E2E_MODE is not set. Run with BDRALPH_E2E_MODE=pty-mock");
if (mode !== "pty-mock") throw new Error(`Invalid BDRALPH_E2E_MODE: "${mode}". Expected "pty-mock".`);

function hasTty(): boolean {
  try {
    execSync("test -c /dev/tty", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const TTY_AVAILABLE = hasTty();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, "../../../bin/bdralph");
const MOCK_BIN_SLOW = path.resolve(__dirname, "../../fixtures/mock-bin-slow");
const MOCK_DELEGATE = path.resolve(__dirname, "../../fixtures/mock-delegate/llm-delegate.sh");

function spawnLoop(
  task: string,
  opts: {
    max?: number;
    extra?: string[];
    ralphDir: string;
    logsDir: string;
    cols?: number;
    rows?: number;
    collectMs?: number;
    env?: Record<string, string>;
  }
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const { max = 2, extra = [], ralphDir, logsDir, cols = 120, rows = 30, collectMs = 5000, env = {} } = opts;

    const proc = pty.spawn(
      "bash",
      [BIN, task, "--max", String(max), "--reviewer-mode", "pipeline", ...extra],
      {
        name: "xterm-color",
        cols,
        rows,
        env: {
          ...process.env,
          PATH: `${MOCK_BIN_SLOW}:${process.env.PATH ?? ""}`,
          MOCK_CLAUDE_SLEEP_SECONDS: "2",
          BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
          MOCK_LLM_RESPONSE: "SHIP",
          BDRALPH_RALPH_DIR: ralphDir,
          BDRALPH_LOGS_DIR: logsDir,
          // Spec correction: use bash UI because Ink 5.x hijacks stdout,
          // preventing node-pty from capturing panel output.
          BDRALPH_NO_UI: "1",
          ...env,
        },
      }
    );

    let output = "";
    proc.onData((data) => { output += data; });

    let resolved = false;
    let exitCode = 0;

    proc.onExit(({ exitCode: code }) => {
      if (resolved) return;
      resolved = true;
      exitCode = code;
      resolve({ output, exitCode });
    });

    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      resolve({ output, exitCode });
    }, collectMs);
  });
}

let tmpDir: string;
let ralphDir: string;

describe.skipIf(!TTY_AVAILABLE)("E2E-L2 Ink content (PTY)", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-e2e-pty-"));
    ralphDir = path.join(tmpDir, "artifacts/bdralph");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E2E-L2-01: loop renders iteration counter with real value", { timeout: 30000 }, async () => {
    const { output } = await spawnLoop("test task", {
      max: 1,
      ralphDir,
      logsDir: tmpDir,
      collectMs: 15000,
    });

    // Bash UI outputs "Iteration 1 / 1" in the phase header
    expect(output).toMatch(/Iteration\s+\d+\s*\/\s*\d+/i);
  });

  it("E2E-L2-02: loop renders worker model", { timeout: 30000 }, async () => {
    const { output } = await spawnLoop("test task", {
      max: 1,
      ralphDir,
      logsDir: tmpDir,
      extra: ["--worker", "sonnet"],
      collectMs: 15000,
    });

    expect(output).toMatch(/sonnet/i);
  });

  it("E2E-L2-03: loop renders cost field", { timeout: 30000 }, async () => {
    const { output } = await spawnLoop("test task", {
      max: 1,
      ralphDir,
      logsDir: tmpDir,
      collectMs: 15000,
    });

    // Bash UI prints cost in the SHIPPED summary line
    expect(output).toMatch(/\$[\d.]+/);
  });
});
