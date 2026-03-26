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
const TRACES_DIR = path.join(REPO_ROOT, "artifacts/bdralph/traces");

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

function readTrace(filename: string): Record<string, unknown> {
  const full = path.join(TRACES_DIR, filename);
  return JSON.parse(fs.readFileSync(full, "utf-8"));
}

beforeEach(() => {
  // Clean traces dir before each test for isolation
  if (fs.existsSync(TRACES_DIR)) {
    fs.rmSync(TRACES_DIR, { recursive: true });
  }
});

describe("Trace smoke tests", () => {
  // T-TRACE-01: L1 trace written after loop execution
  it("T-TRACE-01: L1 trace file exists after loop run", () => {
    runLoop("test task");
    expect(fs.existsSync(path.join(TRACES_DIR, "l1-iteration-1.json"))).toBe(true);
    const trace = readTrace("l1-iteration-1.json");
    expect(trace.layer).toBe("l1");
    expect(trace.iteration).toBe(1);
    expect(trace.cost_usd).toBe(0);
    expect((trace.tokens as { input: number; output: number }).input).toBe(0);
    expect((trace.tokens as { input: number; output: number }).output).toBe(0);
    expect(trace.provider).toBeNull();
    expect(typeof trace.feedback).toBe("string");
    expect(Array.isArray(trace.sensitive_paths_matched)).toBe(true);
    expect(typeof trace.files_checked).toBe("number");
    expect(typeof trace.escalated_to_l4).toBe("boolean");
  });

  // T-TRACE-02: L2 and L3 traces written on SHIP path (pipeline mode)
  it("T-TRACE-02: L2 and L3 traces written in pipeline mode on SHIP", () => {
    runLoop("test task", ["--reviewer-mode", "pipeline"], { MOCK_LLM_RESPONSE: "SHIP" });
    expect(fs.existsSync(path.join(TRACES_DIR, "l2-iteration-1.json"))).toBe(true);
    expect(fs.existsSync(path.join(TRACES_DIR, "l3-iteration-1.json"))).toBe(true);
    expect(readTrace("l2-iteration-1.json").layer).toBe("l2");
    expect(readTrace("l3-iteration-1.json").layer).toBe("l3");
  });

  // T-TRACE-03: traces/ cleaned at session start
  it("T-TRACE-03: stale traces removed at session start", () => {
    fs.mkdirSync(TRACES_DIR, { recursive: true });
    const stale = path.join(TRACES_DIR, "l1-iteration-99.json");
    fs.writeFileSync(stale, JSON.stringify({ stale: true }));
    runLoop("test task");
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(path.join(TRACES_DIR, "l1-iteration-1.json"))).toBe(true);
  });

  // T-TRACE-04: naming — filename iteration matches JSON iteration field
  it("T-TRACE-04: filename iteration number matches JSON iteration field", () => {
    runLoop("test task");
    const trace = readTrace("l1-iteration-1.json");
    expect(trace.iteration).toBe(1);
  });

  // T-TRACE-05: schema — common fields present and typed correctly
  it("T-TRACE-05: common fields present and correctly typed in L1 trace", () => {
    runLoop("test task");
    const trace = readTrace("l1-iteration-1.json");
    expect(typeof trace.session_id).toBe("string");
    expect(typeof trace.iteration).toBe("number");
    expect(typeof trace.layer).toBe("string");
    expect(typeof trace.timestamp_start).toBe("string");
    expect(typeof trace.timestamp_end).toBe("string");
    expect(typeof trace.duration_ms).toBe("number");
    expect(typeof trace.result).toBe("string");
    expect(typeof trace.cost_usd).toBe("number");
    expect(typeof trace.tokens).toBe("object");
    expect(typeof (trace.tokens as { input: number }).input).toBe("number");
    expect(typeof (trace.tokens as { output: number }).output).toBe("number");
    expect(typeof trace.feedback).toBe("string");
  });

  // T-TRACE-06: schema — L1 extra fields present
  it("T-TRACE-06: L1 extra fields present and typed correctly", () => {
    runLoop("test task");
    const trace = readTrace("l1-iteration-1.json");
    expect(Array.isArray(trace.sensitive_paths_matched)).toBe(true);
    expect(typeof trace.files_checked).toBe("number");
    expect(typeof trace.escalated_to_l4).toBe("boolean");
  });

  // T-TRACE-07: BDRALPH_TRACE_HISTORY injects L4 traces into worker prompt
  it("T-TRACE-07: L4 trace history injected into worker prompt when traces exist", () => {
    const seqFile = path.join(REPO_ROOT, "artifacts/bdralph/test-sequence.txt");
    fs.mkdirSync(path.dirname(seqFile), { recursive: true });
    // Sequence for --reviewer-mode pipeline, --max 2:
    // Iter 1: L2=PASS, L3=ESCALATE: test, L4=REVISE: fix it
    // Iter 2: L2=PASS, L3=SHIP (loop ends with SHIP via work-complete mock)
    fs.writeFileSync(seqFile, "PASS\nESCALATE: test escalation\nREVISE: try a different approach\nPASS\nSHIP\n");
    const result = runLoop("test task", ["--max", "2", "--reviewer-mode", "pipeline"], {
      BDRALPH_LLM_DELEGATE: MOCK_DELEGATE_SEQ,
      MOCK_SEQUENCE_FILE: seqFile,
      BDRALPH_MOCK_DUMP_PROMPT: "1",
      BDRALPH_TRACE_HISTORY: "3",
      BDRALPH_SM_THRESHOLD: "0",
    });
    expect(result.stdout).toContain("L4 TRACE HISTORY");
    // cleanup
    if (fs.existsSync(seqFile)) fs.unlinkSync(seqFile);
  });

  // T-TRACE-08: no L4 traces → no TRACE HISTORY block in worker prompt
  it("T-TRACE-08: no L4 traces means no history block in worker prompt", () => {
    const result = runLoop("test task", ["--reviewer-mode", "pipeline"], {
      MOCK_LLM_RESPONSE: "SHIP",
      BDRALPH_MOCK_DUMP_PROMPT: "1",
      BDRALPH_TRACE_HISTORY: "3",
    });
    expect(result.stdout).not.toContain("L4 TRACE HISTORY");
  });

  // T-TRACE-09: BDRALPH_TRACE_HISTORY=2 limits injected traces to 2
  it("T-TRACE-09: BDRALPH_TRACE_HISTORY=1 injects only 1 most recent L4 trace", () => {
    const seqFile = path.join(REPO_ROOT, "artifacts/bdralph/test-seq2.txt");
    fs.mkdirSync(path.dirname(seqFile), { recursive: true });
    // Iter 1: L2=PASS, L3=ESCALATE, L4=REVISE → produces l4-iteration-1.json
    // Iter 2: L2=PASS, L3=ESCALATE, L4=REVISE → produces l4-iteration-2.json
    // Iter 3: L2=PASS, L3=SHIP → ends
    fs.writeFileSync(seqFile, [
      "PASS", "ESCALATE: first escalation", "REVISE: first feedback",
      "PASS", "ESCALATE: second escalation", "REVISE: second feedback",
      "PASS", "SHIP",
    ].join("\n") + "\n");
    const result = runLoop("test task", ["--max", "3", "--reviewer-mode", "pipeline"], {
      BDRALPH_LLM_DELEGATE: MOCK_DELEGATE_SEQ,
      MOCK_SEQUENCE_FILE: seqFile,
      BDRALPH_MOCK_DUMP_PROMPT: "1",
      BDRALPH_TRACE_HISTORY: "1",
      BDRALPH_SM_THRESHOLD: "0",
    });
    // With TRACE_HISTORY=1, the final iteration (iter 3) should only show l4-iteration-2.json.
    // l4-iteration-1.json may appear in iter 2's prompt (it's the only L4 trace then),
    // so we check the last iteration's section only.
    const lastIterSection = result.stdout.split("Iteration 3 /")[1] ?? "";
    expect(lastIterSection).toContain("l4-iteration-2.json");
    expect(lastIterSection).not.toContain("l4-iteration-1.json");
    if (fs.existsSync(seqFile)) fs.unlinkSync(seqFile);
  });

  // T-TRACE-11: L4 extra fields present when L4 runs via L3 escalation
  it("T-TRACE-11: L4 trace has extra fields when triggered by L3 escalation", () => {
    const seqFile = path.join(REPO_ROOT, "artifacts/bdralph/test-seq3.txt");
    fs.mkdirSync(path.dirname(seqFile), { recursive: true });
    // L2=PASS, L3=ESCALATE, L4=SHIP
    fs.writeFileSync(seqFile, "PASS\nESCALATE: needs governance review\nSHIP\n");
    runLoop("test task", ["--max", "1", "--reviewer-mode", "pipeline"], {
      BDRALPH_LLM_DELEGATE: MOCK_DELEGATE_SEQ,
      MOCK_SEQUENCE_FILE: seqFile,
    });
    expect(fs.existsSync(path.join(TRACES_DIR, "l4-iteration-1.json"))).toBe(true);
    const trace = readTrace("l4-iteration-1.json");
    expect(trace.layer).toBe("l4");
    expect(Array.isArray(trace.triggered_by)).toBe(true);
    expect(typeof trace.consecutive_revises_at_trigger).toBe("number");
    expect(typeof trace.l1_escalated).toBe("boolean");
    if (fs.existsSync(seqFile)) fs.unlinkSync(seqFile);
  });
});
