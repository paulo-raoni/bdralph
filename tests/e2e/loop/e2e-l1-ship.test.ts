import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runLoop } from "../helpers/loop-runner";

const mode = process.env.BDRALPH_E2E_MODE;
if (!mode) throw new Error("BDRALPH_E2E_MODE is not set. Run with BDRALPH_E2E_MODE=headless-mock");
if (mode !== "headless-mock") throw new Error(`Invalid BDRALPH_E2E_MODE: "${mode}". Expected "headless-mock".`);

describe("E2E-L1 SHIP / BLOCKED", () => {
  let tmpDir: string;
  let ralphDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-e2e-"));
    ralphDir = path.join(tmpDir, "artifacts/bdralph");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E2E-L1-01: SHIP in 1 iteration", () => {
    const result = runLoop({
      task: "test task",
      max: 3,
      ralphDir,
      logsDir: tmpDir,
      extra: ["--reviewer-mode", "pipeline"],
      env: { MOCK_LLM_RESPONSE: "SHIP" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("SHIPPED");
    // Mock worker does not write work-summary.txt (only real claude does).
    // The loop reads it with fallback: "No summary written".
  });

  it("E2E-L1-02: BLOCKED when mock always returns REVISE", () => {
    const result = runLoop({
      task: "test task",
      max: 2,
      ralphDir,
      logsDir: tmpDir,
      extra: ["--reviewer-mode", "pipeline"],
      env: { MOCK_LLM_RESPONSE: "REVISE" },
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toMatch(/BLOCKED|Max iterations/i);
  });
});
