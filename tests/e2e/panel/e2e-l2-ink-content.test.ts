/**
 * E2E Nível 2 — Ink panel content tests (PTY)
 *
 * E2E-L2-01: Loop renders iteration counter with real value
 * E2E-L2-02: Loop renders worker model
 * E2E-L2-03: Loop renders cost field
 *
 * These tests use BDRALPH_INK_CAPTURE_FILE to redirect Ink output to a
 * temporary file, allowing content assertions on real Ink rendering
 * without relying on node-pty stdout capture (Ink writes to /dev/tty
 * directly, bypassing the PTY master).
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
    captureFile: string;
    cols?: number;
    rows?: number;
    collectMs?: number;
    env?: Record<string, string>;
  }
): Promise<{ output: string; inkOutput: string; exitCode: number }> {
  return new Promise((resolve) => {
    const { max = 2, extra = [], ralphDir, logsDir, captureFile, cols = 120, rows = 30, collectMs = 5000, env = {} } = opts;

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
          // node --import tsx startup takes ~9s; the mock worker must run long
          // enough for the Ink panel to initialize and render at least one frame.
          MOCK_CLAUDE_SLEEP_SECONDS: "12",
          BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
          MOCK_LLM_RESPONSE: "SHIP",
          BDRALPH_RALPH_DIR: ralphDir,
          BDRALPH_LOGS_DIR: logsDir,
          BDRALPH_INK_CAPTURE_FILE: captureFile,
          COLUMNS: String(cols),
          LINES: String(rows),
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
      // Small delay to let the capture file flush
      setTimeout(() => {
        const inkOutput = fs.existsSync(captureFile)
          ? fs.readFileSync(captureFile, "utf-8")
          : "";
        resolve({ output, inkOutput, exitCode });
      }, 500);
    });

    setTimeout(() => {
      if (resolved) return;
      resolved = true;
      proc.kill();
      setTimeout(() => {
        const inkOutput = fs.existsSync(captureFile)
          ? fs.readFileSync(captureFile, "utf-8")
          : "";
        resolve({ output, inkOutput, exitCode });
      }, 500);
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

  it("E2E-L2-01: loop renders iteration counter with real value", { timeout: 90000 }, async () => {
    const captureFile = path.join(tmpDir, "ink-output-01.txt");
    const { inkOutput, output } = await spawnLoop("test task", {
      max: 1,
      ralphDir,
      logsDir: tmpDir,
      captureFile,
      collectMs: 45000,
    });

    // Ink renders: "bdralph  •  Iter N / M  •  ..."
    const combined = inkOutput + output;
    expect(combined).toMatch(/Iter\s+\d+\s*\/\s*\d+/i);
  });

  it("E2E-L2-02: loop renders worker model", { timeout: 90000 }, async () => {
    const captureFile = path.join(tmpDir, "ink-output-02.txt");
    const { inkOutput, output } = await spawnLoop("test task", {
      max: 1,
      ralphDir,
      logsDir: tmpDir,
      captureFile,
      extra: ["--worker", "sonnet"],
      collectMs: 45000,
    });

    const combined = inkOutput + output;
    expect(combined).toMatch(/sonnet/i);
  });

  it("E2E-L2-03: loop renders cost field", { timeout: 90000 }, async () => {
    const captureFile = path.join(tmpDir, "ink-output-03.txt");
    const { inkOutput, output } = await spawnLoop("test task", {
      max: 1,
      ralphDir,
      logsDir: tmpDir,
      captureFile,
      collectMs: 45000,
    });

    // Ink renders cost as "$0.00 / $0.50 (budget)"
    const combined = inkOutput + output;
    expect(combined).toMatch(/\$[\d.]+/);
  });
});
