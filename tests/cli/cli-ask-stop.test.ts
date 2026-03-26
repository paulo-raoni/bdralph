import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BIN = path.resolve(__dirname, "../../bin/bdralph");
const MOCK_BIN = path.resolve(__dirname, "../fixtures/mock-bin");
const REPO_ROOT = path.resolve(__dirname, "../..");
const SIGNAL_FILE = path.join(REPO_ROOT, "artifacts/bdralph/operator-signal.json");

function runBin(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("bash", [BIN, ...args], {
    encoding: "utf-8",
    timeout: 5000,
    env: {
      ...process.env,
      PATH: `${MOCK_BIN}:${process.env.PATH ?? ""}`,
      BDRALPH_LOOP_MOCK: "1",
    },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

beforeEach(() => {
  if (fs.existsSync(SIGNAL_FILE)) fs.unlinkSync(SIGNAL_FILE);
});

describe("bdralph ask and stop CLI behavior", () => {

  // T-CLI-ASK-01: bdralph ask writes signal and exits 0 (no loop required)
  // Documents current behavior: ask succeeds even without active loop.
  // The operator-signal.json is written; if no loop is running, it waits
  // until the next session starts (cleaned at session start).
  // SM-01 from EDGE_CASES.md: no error message when loop is not active.
  it("T-CLI-ASK-01: bdralph ask exits 0 and writes message signal without active loop", () => {
    const result = runBin(["ask", "is the task done?"]);
    expect(result.exitCode).toBe(0);
    // Signal written
    expect(fs.existsSync(SIGNAL_FILE)).toBe(true);
    const signal = JSON.parse(fs.readFileSync(SIGNAL_FILE, "utf-8"));
    expect(signal.action).toBe("message");
    expect(signal.content).toBe("is the task done?");
    // Current behavior: no warning about loop not being active
    // This test documents SM-01 as a known gap (not a bug to fix here)
    expect(result.stdout).toContain("Message written");
  });

});
