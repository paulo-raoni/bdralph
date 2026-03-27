import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runLoop } from "../helpers/loop-runner";

const mode = process.env.BDRALPH_E2E_MODE;
if (!mode) throw new Error("BDRALPH_E2E_MODE is not set. Run with BDRALPH_E2E_MODE=headless-mock");
if (mode !== "headless-mock") throw new Error(`Invalid BDRALPH_E2E_MODE: "${mode}". Expected "headless-mock".`);

describe("E2E-L1 Second Mind", () => {
  let tmpDir: string;
  let ralphDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-e2e-"));
    ralphDir = path.join(tmpDir, "artifacts/bdralph");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E2E-L1-05: Second Mind fires at threshold (floor(max/2))", () => {
    // With --max 4, threshold = floor(4/2) = 2. Loop runs all 4 iterations with REVISE.
    const result = runLoop({
      task: "test task",
      max: 4,
      ralphDir,
      logsDir: tmpDir,
      extra: ["--reviewer-mode", "pipeline"],
      env: { MOCK_LLM_RESPONSE: "REVISE" },
      timeout: 60000,
    });

    // Second Mind fires when iteration >= threshold (2). The loop prints a status line.
    expect(result.stdout).toMatch(/[Ss]econd.?[Mm]ind/i);
  });
});
