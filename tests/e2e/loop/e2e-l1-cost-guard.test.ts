import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runLoop } from "../helpers/loop-runner";

const mode = process.env.BDRALPH_E2E_MODE;
if (!mode) throw new Error("BDRALPH_E2E_MODE is not set. Run with BDRALPH_E2E_MODE=headless-mock");
if (mode !== "headless-mock") throw new Error(`Invalid BDRALPH_E2E_MODE: "${mode}". Expected "headless-mock".`);

describe("E2E-L1 Cost Guard", () => {
  let tmpDir: string;
  let ralphDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-e2e-"));
    ralphDir = path.join(tmpDir, "artifacts/bdralph");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E2E-L1-10: cost guard blocks loop when budget exhausted", () => {
    // With budget 0.00001 and mock delegate writing cost_usd: 0.0001 per call,
    // the first review call should exceed the budget.
    const result = runLoop({
      task: "test task",
      max: 3,
      ralphDir,
      logsDir: tmpDir,
      extra: ["--reviewer-mode", "pipeline", "--budget", "0.00001"],
      env: { MOCK_LLM_RESPONSE: "REVISE" },
      timeout: 60000,
    });

    // The cost guard should log when it blocks a provider
    expect(result.stdout).toMatch(/cost|budget|blocked/i);
  });
});
