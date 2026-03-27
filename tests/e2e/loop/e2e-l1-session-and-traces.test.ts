import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runLoop } from "../helpers/loop-runner";
import { writeSignal } from "../helpers/signal-writer";
import { readTrace, traceExists } from "../helpers/trace-reader";

const mode = process.env.BDRALPH_E2E_MODE;
if (!mode) throw new Error("BDRALPH_E2E_MODE is not set. Run with BDRALPH_E2E_MODE=headless-mock");
if (mode !== "headless-mock") throw new Error(`Invalid BDRALPH_E2E_MODE: "${mode}". Expected "headless-mock".`);

describe("E2E-L1 Session and Traces", () => {
  let tmpDir: string;
  let ralphDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-e2e-"));
    ralphDir = path.join(tmpDir, "artifacts/bdralph");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E2E-L1-08: operator-signal.json cleaned up at session start", () => {
    // Write a stale stop-now signal before the loop starts
    fs.mkdirSync(ralphDir, { recursive: true });
    writeSignal(ralphDir, "stop-now");

    const result = runLoop({
      task: "test task",
      max: 1,
      ralphDir,
      logsDir: tmpDir,
      extra: ["--reviewer-mode", "pipeline"],
      env: { MOCK_LLM_RESPONSE: "SHIP" },
    });

    // Session-start cleanup removes operator-signal.json — see ralph-loop.sh:139
    // The stale stop-now signal should NOT stop the loop.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("SHIPPED");
  });

  it("E2E-L1-09: traces written after each iteration", () => {
    const result = runLoop({
      task: "test task",
      max: 2,
      ralphDir,
      logsDir: tmpDir,
      extra: ["--reviewer-mode", "pipeline"],
      env: { MOCK_LLM_RESPONSE: "REVISE" },
    });

    expect(traceExists(ralphDir, "l1-iteration-1.json")).toBe(true);
    expect(traceExists(ralphDir, "l1-iteration-2.json")).toBe(true);

    const trace1 = readTrace(ralphDir, "l1-iteration-1.json");
    expect(trace1.layer).toBe("l1");
    expect(trace1.iteration).toBe(1);

    const trace2 = readTrace(ralphDir, "l1-iteration-2.json");
    expect(trace2.layer).toBe("l1");
    expect(trace2.iteration).toBe(2);
  });
});
