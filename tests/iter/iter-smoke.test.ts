import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOOP_SCRIPT = path.resolve(__dirname, "../../src/loop/ralph-loop.sh");
const MOCK_BIN = path.resolve(__dirname, "../fixtures/mock-bin");
const MOCK_DELEGATE = path.resolve(__dirname, "../fixtures/mock-delegate/llm-delegate.sh");
const MOCK_DELEGATE_SEQ = path.resolve(__dirname, "../fixtures/mock-delegate/llm-delegate-sequence.sh");
const REPO_ROOT = path.resolve(__dirname, "../..");
const ITER_LOG = path.join(REPO_ROOT, "artifacts/bdralph/iteration-log.json");

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
        MOCK_LLM_RESPONSE: "SHIP",
        ...env,
      },
    });
    return { exitCode: 0, stdout };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { exitCode: e.status ?? 1, stdout: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

beforeEach(() => {
  // Ensure clean state before each test
  if (fs.existsSync(ITER_LOG)) {
    fs.unlinkSync(ITER_LOG);
  }
});

describe("Iteration log smoke tests", () => {

  // T-ITER-01: iteration-log.json deleted at session start
  it("T-ITER-01: stale iteration-log.json is deleted at session start", () => {
    // Pre-seed a stale log
    fs.mkdirSync(path.dirname(ITER_LOG), { recursive: true });
    fs.writeFileSync(ITER_LOG, JSON.stringify({ stale: true }));
    expect(fs.existsSync(ITER_LOG)).toBe(true);

    runLoop("test task");

    // After the loop runs, the stale file should be gone
    // (it was deleted at session start; mock claude does not write a new one)
    expect(fs.existsSync(ITER_LOG)).toBe(false);
  });

  // T-ITER-02: worker prompt contains iteration-log.json in STATE FILES
  it("T-ITER-02: worker prompt mentions iteration-log.json in STATE FILES", () => {
    const result = runLoop("test task", [], {
      BDRALPH_MOCK_DUMP_PROMPT: "1",
    });
    expect(result.stdout).toContain("iteration-log.json");
  });

  // T-ITER-03: worker prompt contains instruction to write iteration-log.json
  it("T-ITER-03: worker prompt contains write instruction for iteration-log.json", () => {
    const result = runLoop("test task", [], {
      BDRALPH_MOCK_DUMP_PROMPT: "1",
    });
    // The prompt must tell the worker to write the file before work-complete.txt
    expect(result.stdout).toContain("Write iteration log BEFORE");
  });

  // T-ITER-04: iteration-log.json written by worker on iter 1 persists to iter 2
  // Design note (M4-05): the loop passes the file PATH, not the content.
  // The worker reads the file itself via `cat`. The loop does NOT inject the content.
  // This test verifies: (a) mock claude writes the file on iter 1, (b) the loop does NOT
  // delete it between iterations (only at session START), so iter 2 can read it.
  it("T-ITER-04: iteration-log.json written on iter 1 persists until iter 2 worker runs", () => {
    const seqFile = path.join(REPO_ROOT, "artifacts/bdralph/test-iter-seq.txt");
    fs.mkdirSync(path.dirname(seqFile), { recursive: true });
    // Pipeline mode: iter 1 L2=PASS, L3=REVISE → iter 2 L2=PASS, L3=SHIP
    fs.writeFileSync(seqFile, "PASS\nREVISE: try again\nPASS\nSHIP\n");

    runLoop("test task", ["--max", "2", "--reviewer-mode", "pipeline"], {
      BDRALPH_LLM_DELEGATE: MOCK_DELEGATE_SEQ,
      MOCK_SEQUENCE_FILE: seqFile,
      BDRALPH_MOCK_WRITE_ITER_LOG: "1",
    });

    // After a 2-iteration run, the iteration-log.json written by iter 1's worker should
    // still exist (it is only cleaned at SESSION start, not between iterations).
    // This confirms the file is available for iter 2's worker to read.
    expect(fs.existsSync(ITER_LOG)).toBe(true);
    const log = JSON.parse(fs.readFileSync(ITER_LOG, "utf-8"));
    expect(log.strategy).toBe("mock strategy from previous iteration");

    if (fs.existsSync(seqFile)) fs.unlinkSync(seqFile);
  });

  // T-ITER-05: worker prompt references iteration-log.json path (worker reads it, loop does not inject)
  // Design note (M4-05): the loop passes the path; the worker does `cat` itself.
  // This test verifies the prompt contains the path reference and read instruction.
  it("T-ITER-05: worker prompt references iteration-log.json for worker to read", () => {
    const result = runLoop("test task", [], {
      BDRALPH_MOCK_DUMP_PROMPT: "1",
    });

    // The prompt must reference the file for the worker to read
    expect(result.stdout).toContain("iteration-log.json");
    // The prompt must instruct the worker to cat it
    expect(result.stdout).toContain("cat artifacts/bdralph/iteration-log.json");
  });

});
