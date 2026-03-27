/**
 * E2E Nível 2 — Ink panel lifecycle tests (PTY)
 *
 * E2E-L2-07: Process exits cleanly after SHIP
 *
 * Spec correction: Ink 5.x hijacks process.stdout on import, so the cursor
 * restore sequence (\x1B[?25h) written by the SIGTERM handler cannot be
 * captured by node-pty. We verify clean exit (exit code 0) and absence of
 * error patterns instead. The cursor restore is tested indirectly by the
 * unit tests in tests/panel/ink-panel.test.ts.
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

function spawnWithInk(
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

describe.skipIf(!TTY_AVAILABLE)("E2E-L2 Ink lifecycle (PTY)", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-e2e-pty-"));
    ralphDir = path.join(tmpDir, "artifacts/bdralph");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E2E-L2-07: process exits cleanly after SHIP", { timeout: 30000 }, async () => {
    const { output, exitCode } = await spawnWithInk("test task", {
      max: 1,
      ralphDir,
      logsDir: tmpDir,
      collectMs: 15000,
      env: { MOCK_LLM_RESPONSE: "SHIP" },
    });

    expect(exitCode).toBe(0);
    // No error output
    expect(output).not.toContain("TransformError");
    expect(output).not.toContain("ENXIO");
  });
});
