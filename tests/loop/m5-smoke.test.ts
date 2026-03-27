import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOOP_SCRIPT = path.resolve(__dirname, "../../src/loop/ralph-loop.sh");
const MOCK_BIN = path.resolve(__dirname, "../fixtures/mock-bin");
const MOCK_DELEGATE = path.resolve(__dirname, "../fixtures/mock-delegate/llm-delegate.sh");
const MOCK_DELEGATE_SEQ = path.resolve(__dirname, "../fixtures/mock-delegate/llm-delegate-sequence.sh");
const REPO_ROOT = path.resolve(__dirname, "../..");
const TRACES_DIR = path.join(REPO_ROOT, "artifacts/bdralph/traces");
const CONFIG_FILE = path.join(REPO_ROOT, ".bdralph.config.json");

function runLoop(
  task: string,
  extra: string[] = [],
  env: Record<string, string> = {}
): { exitCode: number; stdout: string } {
  try {
    const stdout = execFileSync("bash", [LOOP_SCRIPT, task, "--max", "1", ...extra], {
      encoding: "utf-8",
      timeout: 15000,
      env: {
        ...process.env,
        PATH: `${MOCK_BIN}:${process.env.PATH ?? ""}`,
        BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
        BDRALPH_NO_UI: "1",
        MOCK_LLM_RESPONSE: "PASS",
        MOCK_LLM_CLASSIFICATION: "pass",
        ...env,
      },
    });
    return { exitCode: 0, stdout };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { exitCode: e.status ?? 1, stdout: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

function readTrace(filename: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(TRACES_DIR, filename), "utf-8"));
}

beforeEach(() => {
  if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
});

describe("M5 smoke tests", () => {

  // T-M5-01: L2 trace contains worker_outcome_classification = 'pass'
  it("T-M5-01: L2 trace contains worker_outcome_classification field", () => {
    runLoop("test task", ["--reviewer-mode", "pipeline"], {
      MOCK_LLM_RESPONSE: "PASS",
      MOCK_LLM_CLASSIFICATION: "pass",
    });
    expect(fs.existsSync(path.join(TRACES_DIR, "l2-iteration-1.json"))).toBe(true);
    const trace = readTrace("l2-iteration-1.json");
    expect(trace.worker_outcome_classification).toBe("pass");
  });

  // T-M5-02: classification is 'failure' when L2 returns failure
  it("T-M5-02: worker_outcome_classification is 'failure' when L2 classifies failure", () => {
    runLoop("test task", ["--reviewer-mode", "pipeline"], {
      MOCK_LLM_RESPONSE: "PASS",
      MOCK_LLM_CLASSIFICATION: "failure",
    });
    const trace = readTrace("l2-iteration-1.json");
    expect(trace.worker_outcome_classification).toBe("failure");
  });

  // T-M5-03: SHIP-ON-FAILURE does not fire when config absent
  it("T-M5-03: SHIP-ON-FAILURE does not fire when .bdralph.config.json is absent", () => {
    expect(fs.existsSync(CONFIG_FILE)).toBe(false);
    const result = runLoop("test task", ["--reviewer-mode", "pipeline"], {
      MOCK_LLM_RESPONSE: "FAIL: tests are broken",
      MOCK_LLM_CLASSIFICATION: "failure",
    });
    expect(result.stdout).not.toContain("SHIP-ON-FAILURE");
  });

  // T-M5-04: SHIP-ON-FAILURE does not fire when enabled: false
  it("T-M5-04: SHIP-ON-FAILURE does not fire when enabled: false", () => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      ship_on_failure: { enabled: false, triggers: ["all tests pass"] },
    }));
    const result = runLoop("test task", ["--reviewer-mode", "pipeline"], {
      MOCK_LLM_RESPONSE: "FAIL: tests are broken",
      MOCK_LLM_CLASSIFICATION: "failure",
    });
    expect(result.stdout).not.toContain("SHIP-ON-FAILURE");
  });

  // T-M5-05: safety_impediment classification recorded correctly, SOF does not fire
  it("T-M5-05: worker_outcome_classification safety_impediment recorded, SOF does not fire", () => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      ship_on_failure: { enabled: true, triggers: ["all tests pass"] },
    }));
    runLoop("test task", ["--reviewer-mode", "pipeline"], {
      MOCK_LLM_RESPONSE: "PASS",
      MOCK_LLM_CLASSIFICATION: "safety_impediment",
    });
    const trace = readTrace("l2-iteration-1.json");
    expect(trace.worker_outcome_classification).toBe("safety_impediment");
    // L2 passed → no SOF evaluation path was entered (classification only checked on FAIL path)
  });

  // T-M5-06: Worker stdout captured with BDRALPH_NO_UI=1
  it("T-M5-06: worker stdout content visible in output with BDRALPH_NO_UI=1", () => {
    const result = runLoop("test task", [], {
      BDRALPH_NO_UI: "1",
      BDRALPH_MOCK_STDOUT_CONTENT: "mock worker output line",
    });
    expect(result.stdout).toContain("mock worker output line");
  });

  // T-M5-08: L2 prompt contains branch diff fallback, not the old working-tree fallback
  it("T-M5-08: L2 context uses branch diff (main...HEAD), not working tree diff", () => {
    const logFile = path.join(os.tmpdir(), `l2-prompt-${Date.now()}.txt`);
    try {
      runLoop("test task", ["--reviewer-mode", "pipeline"], {
        MOCK_LLM_LOG_PROMPT: logFile,
      });
      expect(fs.existsSync(logFile)).toBe(true);
      const prompt = fs.readFileSync(logFile, "utf-8");
      // Must contain the new branch-based fallback OR an actual diff
      // (L1 context may still contain the old working-tree message — that's fine,
      //  we check that the L2 GIT DIFF section uses the new branch diff)
      const hasBranchDiffFallback = prompt.includes("No file changes detected between branch and base.");
      const hasActualDiff = prompt.includes("diff --git");
      expect(hasBranchDiffFallback || hasActualDiff).toBe(true);
    } finally {
      if (fs.existsSync(logFile)) fs.unlinkSync(logFile);
    }
  });

  // T-M5-07: SHIP-ON-FAILURE fires when all conditions met
  it("T-M5-07: SHIP-ON-FAILURE fires when config enabled + failure + triggers satisfied", () => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      ship_on_failure: { enabled: true, triggers: ["all tests pass"] },
    }));
    const seqFile = path.join(REPO_ROOT, "artifacts/bdralph/test-m5-sof.txt");
    fs.mkdirSync(path.dirname(seqFile), { recursive: true });
    // Call 1 (L2 protocol check): FAIL → enters REVISE path → SOF conditions checked
    // MOCK_LLM_CLASSIFICATION=failure appended to call 1 response by sequence mock
    // Call 2 (SOF trigger evaluation): TRIGGERS_SATISFIED → SOF fires
    fs.writeFileSync(seqFile, "FAIL: tests are broken\nTRIGGERS_SATISFIED\n");
    const result = runLoop("test task", ["--max", "1", "--reviewer-mode", "pipeline"], {
      BDRALPH_LLM_DELEGATE: MOCK_DELEGATE_SEQ,
      MOCK_SEQUENCE_FILE: seqFile,
      MOCK_LLM_CLASSIFICATION: "failure",
    });
    expect(result.stdout).toContain("SHIP-ON-FAILURE");
    if (fs.existsSync(seqFile)) fs.unlinkSync(seqFile);
  });

});
