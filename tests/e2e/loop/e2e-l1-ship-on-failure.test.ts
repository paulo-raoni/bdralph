import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runLoop, MOCK_DELEGATE_SEQ } from "../helpers/loop-runner";

const mode = process.env.BDRALPH_E2E_MODE;
if (!mode) throw new Error("BDRALPH_E2E_MODE is not set. Run with BDRALPH_E2E_MODE=headless-mock");
if (mode !== "headless-mock") throw new Error(`Invalid BDRALPH_E2E_MODE: "${mode}". Expected "headless-mock".`);

const REPO_ROOT = path.resolve(__dirname, "../../..");
const configFile = path.join(REPO_ROOT, ".bdralph.config.json");

describe.sequential("E2E-L1-07 SHIP-ON-FAILURE", () => {
  let tmpDir: string;
  let ralphDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-e2e-"));
    ralphDir = path.join(tmpDir, "artifacts/bdralph");

    // Write .bdralph.config.json to REPO_ROOT (loop reads it from there)
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        ship_on_failure: {
          enabled: true,
          triggers: ["tests pass"],
        },
      })
    );
  });

  afterEach(() => {
    try {
      fs.unlinkSync(configFile);
    } catch {
      // already cleaned
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E2E-L1-07: SHIP-ON-FAILURE fires when L2 confirms triggers satisfied", () => {
    // Sequence: L2 returns FAIL (with classification: failure), SOF check returns TRIGGERS_SATISFIED.
    // Use max=1 so Second Mind doesn't fire (threshold=floor(1/2)=0, check requires >0),
    // ensuring L2 gets the first line from the sequence file.
    const seqFile = path.join(tmpDir, "sequence.txt");
    fs.writeFileSync(seqFile, "FAIL: worker could not complete\nTRIGGERS_SATISFIED\n");

    const result = runLoop({
      task: "test task",
      max: 1,
      ralphDir,
      logsDir: tmpDir,
      extra: ["--reviewer-mode", "pipeline"],
      env: {
        MOCK_SEQUENCE_FILE: seqFile,
        BDRALPH_LLM_DELEGATE: MOCK_DELEGATE_SEQ,
        // L2 classification must be "failure" for SOF to activate — see ralph-loop.sh:1442
        MOCK_LLM_CLASSIFICATION: "failure",
      },
      timeout: 60000,
    });

    // The loop should SHIP via SHIP-ON-FAILURE override
    expect(result.stdout).toMatch(/SHIP-ON-FAILURE|SHIPPED/i);
    expect(result.exitCode).toBe(0);
  });
});
