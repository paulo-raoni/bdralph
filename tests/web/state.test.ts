import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  buildDashboardState,
  classifyWorkerLine,
  classifyWorkerOutput,
  buildPipeline,
  deriveStatus,
  readCostFromGuard,
  safeReadFile,
} from "../../src/web/state.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-test-"));
}

function writeFile(dir: string, name: string, content: string): void {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

describe("buildDashboardState", () => {
  let ralphDir: string;
  let logsDir: string;

  beforeEach(() => {
    ralphDir = makeTmpDir();
    logsDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(ralphDir, { recursive: true, force: true });
    fs.rmSync(logsDir, { recursive: true, force: true });
  });

  it("returns idle defaults when RALPH_DIR is empty", () => {
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.status).toBe("idle");
    expect(state.task).toBe("");
    expect(state.iteration).toBe(0);
    expect(state.maxIterations).toBe(0);
    expect(state.workerOutput).toEqual([]);
    expect(state.alerts).toEqual([]);
    expect(state.secondMind).toEqual([]);
    expect(state.pipeline).toHaveLength(4);
    expect(state.pipeline.every((l) => l.state === "wait")).toBe(true);
  });

  it("reads iteration.txt → iteration number", () => {
    writeFile(ralphDir, "task.md", "some task");
    writeFile(ralphDir, "iteration.txt", "3");
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.iteration).toBe(3);
  });

  it("reads review-result.txt = SHIP + .bdralph-complete → status shipped", () => {
    writeFile(ralphDir, "task.md", "some task");
    writeFile(ralphDir, "review-result.txt", "SHIP");
    writeFile(ralphDir, ".bdralph-complete", "");
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.status).toBe("shipped");
  });

  it("reads review-result.txt = BLOCKED + .bdralph-complete → status blocked", () => {
    writeFile(ralphDir, "task.md", "some task");
    writeFile(ralphDir, "review-result.txt", "BLOCKED");
    writeFile(ralphDir, ".bdralph-complete", "");
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.status).toBe("blocked");
  });

  it("reads task.md exists + .bdralph-complete absent → status running", () => {
    writeFile(ralphDir, "task.md", "some task");
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.status).toBe("running");
  });

  it("reads traces/l1 with result PASS → L1 layer state done", () => {
    writeFile(ralphDir, "task.md", "some task");
    writeFile(ralphDir, "iteration.txt", "3");
    writeFile(
      ralphDir,
      "traces/l1-iteration-3.json",
      JSON.stringify({
        iteration: 3,
        layer: "l1",
        result: "PASS",
        cost_usd: 0,
        escalated_to_l4: false,
      })
    );
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.pipeline[0].state).toBe("done");
    expect(state.pipeline[0].result).toBe("PASS");
  });

  it("reads traces/l1 with escalated_to_l4 → L2/L3 skip, L4 active", () => {
    writeFile(ralphDir, "task.md", "some task");
    writeFile(ralphDir, "iteration.txt", "3");
    writeFile(
      ralphDir,
      "traces/l1-iteration-3.json",
      JSON.stringify({
        iteration: 3,
        layer: "l1",
        result: "SENSITIVE",
        cost_usd: 0,
        escalated_to_l4: true,
      })
    );
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.pipeline[0].state).toBe("warn");
    expect(state.pipeline[1].state).toBe("skip");
    expect(state.pipeline[2].state).toBe("skip");
    expect(state.pipeline[3].state).toBe("active");
  });

  it("infers active layer when trace exists for previous layers but not current", () => {
    writeFile(ralphDir, "task.md", "some task");
    writeFile(ralphDir, "iteration.txt", "2");
    writeFile(
      ralphDir,
      "traces/l1-iteration-2.json",
      JSON.stringify({ iteration: 2, layer: "l1", result: "PASS" })
    );
    writeFile(
      ralphDir,
      "traces/l2-iteration-2.json",
      JSON.stringify({ iteration: 2, layer: "l2", result: "PASS" })
    );
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.pipeline[0].state).toBe("done");
    expect(state.pipeline[1].state).toBe("done");
    expect(state.pipeline[2].state).toBe("active");
    expect(state.pipeline[3].state).toBe("wait");
  });

  it("reads work-summary.txt → workerOutput lines, correctly classified", () => {
    writeFile(ralphDir, "task.md", "some task");
    writeFile(
      ralphDir,
      "work-summary.txt",
      "› Reading task.md...\n✗ FAIL src/test.ts\n› SHIP approved\n"
    );
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.workerOutput).toHaveLength(3);
    expect(state.workerOutput[0].type).toBe("normal");
    expect(state.workerOutput[1].type).toBe("error");
    expect(state.workerOutput[2].type).toBe("info");
  });

  it("reads UI_STATE_PREFIX_worker_output.txt when prefix provided", () => {
    const prefixDir = makeTmpDir();
    const prefix = path.join(prefixDir, "ralph_ui_test");
    fs.writeFileSync(`${prefix}_worker_output.txt`, "› line one\n› line two\n");
    writeFile(ralphDir, "task.md", "some task");

    const state = buildDashboardState({
      ralphDir,
      logsDir,
      uiStatePrefix: prefix,
    });
    expect(state.workerOutput).toHaveLength(2);
    expect(state.workerOutput[0].text).toBe("› line one");

    fs.rmSync(prefixDir, { recursive: true, force: true });
  });

  it("reads UI_STATE_PREFIX_banner_message.txt → alerts array", () => {
    const prefixDir = makeTmpDir();
    const prefix = path.join(prefixDir, "ralph_ui_test");
    fs.writeFileSync(
      `${prefix}_banner_message.txt`,
      "L4 escalation triggered"
    );
    writeFile(ralphDir, "task.md", "some task");

    const state = buildDashboardState({
      ralphDir,
      logsDir,
      uiStatePrefix: prefix,
    });
    expect(state.alerts).toContain("L4 escalation triggered");

    fs.rmSync(prefixDir, { recursive: true, force: true });
  });

  it("reads UI_STATE_PREFIX_session_elapsed.txt → elapsedSeconds", () => {
    const prefixDir = makeTmpDir();
    const prefix = path.join(prefixDir, "ralph_ui_test");
    fs.writeFileSync(`${prefix}_session_elapsed.txt`, "272");
    writeFile(ralphDir, "task.md", "some task");

    const state = buildDashboardState({
      ralphDir,
      logsDir,
      uiStatePrefix: prefix,
    });
    expect(state.elapsedSeconds).toBe(272);

    fs.rmSync(prefixDir, { recursive: true, force: true });
  });

  it("reads UI_STATE_PREFIX_max_iterations.txt → maxIterations", () => {
    const prefixDir = makeTmpDir();
    const prefix = path.join(prefixDir, "ralph_ui_test");
    fs.writeFileSync(`${prefix}_max_iterations.txt`, "5");
    writeFile(ralphDir, "task.md", "some task");

    const state = buildDashboardState({
      ralphDir,
      logsDir,
      uiStatePrefix: prefix,
    });
    expect(state.maxIterations).toBe(5);

    fs.rmSync(prefixDir, { recursive: true, force: true });
  });

  it("never throws on missing files — returns defaults", () => {
    const nonexistent = path.join(os.tmpdir(), "bdralph-no-exist-" + Date.now());
    expect(() =>
      buildDashboardState({ ralphDir: nonexistent, logsDir: nonexistent })
    ).not.toThrow();
    const state = buildDashboardState({
      ralphDir: nonexistent,
      logsDir: nonexistent,
    });
    expect(state.status).toBe("idle");
  });

  it("builds shipped terminal state", () => {
    writeFile(ralphDir, "task.md", "some task");
    writeFile(ralphDir, "iteration.txt", "2");
    writeFile(ralphDir, "review-result.txt", "SHIP");
    writeFile(ralphDir, ".bdralph-complete", "");
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.terminalState).toBeDefined();
    expect(state.terminalState!.type).toBe("shipped");
  });

  it("builds blocked terminal state", () => {
    writeFile(ralphDir, "task.md", "some task");
    writeFile(ralphDir, "iteration.txt", "3");
    writeFile(ralphDir, "review-result.txt", "BLOCKED");
    writeFile(ralphDir, ".bdralph-complete", "");
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.terminalState).toBeDefined();
    expect(state.terminalState!.type).toBe("blocked");
  });

  it("reads second-mind-response.txt → secondMind array", () => {
    writeFile(ralphDir, "task.md", "some task");
    writeFile(
      ralphDir,
      "second-mind-response.txt",
      "Focus on validation layer"
    );
    const state = buildDashboardState({ ralphDir, logsDir });
    expect(state.secondMind).toHaveLength(1);
    expect(state.secondMind[0].text).toBe("Focus on validation layer");
  });
});

describe("classifyWorkerLine", () => {
  it("classifies ✗ as error", () => {
    expect(classifyWorkerLine("✗ FAIL src/test.ts")).toBe("error");
  });

  it("classifies Error: as error", () => {
    expect(classifyWorkerLine("Error: something broke")).toBe("error");
  });

  it("classifies FAIL as error", () => {
    expect(classifyWorkerLine("FAIL src/services/TaskService.test.ts")).toBe(
      "error"
    );
  });

  it("classifies TypeError as error", () => {
    expect(
      classifyWorkerLine("TypeError: Cannot read property 'title'")
    ).toBe("error");
  });

  it("classifies ⚠ as warning", () => {
    expect(classifyWorkerLine("⚠ 3 tests failed")).toBe("warning");
  });

  it("classifies warning as warning (case insensitive)", () => {
    expect(classifyWorkerLine("Warning: deprecated API")).toBe("warning");
  });

  it("classifies deprecated as warning", () => {
    expect(classifyWorkerLine("This method is deprecated")).toBe("warning");
  });

  it("classifies SHIP as info", () => {
    expect(classifyWorkerLine("› SHIP approved")).toBe("info");
  });

  it("classifies REVISE as info", () => {
    expect(classifyWorkerLine("Result: REVISE")).toBe("info");
  });

  it("classifies escalat as info", () => {
    expect(classifyWorkerLine("L1 escalated to L4")).toBe("info");
  });

  it("classifies normal lines as normal", () => {
    expect(classifyWorkerLine("› Reading task.md...")).toBe("normal");
  });
});

describe("classifyWorkerOutput", () => {
  it("returns empty array for empty string", () => {
    expect(classifyWorkerOutput("")).toEqual([]);
  });

  it("classifies multiple lines", () => {
    const result = classifyWorkerOutput(
      "› ok\n✗ FAIL\n⚠ warn\n› SHIP done"
    );
    expect(result).toHaveLength(4);
    expect(result[0].type).toBe("normal");
    expect(result[1].type).toBe("error");
    expect(result[2].type).toBe("warning");
    expect(result[3].type).toBe("info");
  });
});

describe("deriveStatus", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns idle when dir is empty", () => {
    expect(deriveStatus(dir)).toBe("idle");
  });

  it("returns running when task.md exists", () => {
    writeFile(dir, "task.md", "task");
    expect(deriveStatus(dir)).toBe("running");
  });

  it("returns shipped on SHIP + complete", () => {
    writeFile(dir, "review-result.txt", "SHIP");
    writeFile(dir, ".bdralph-complete", "");
    expect(deriveStatus(dir)).toBe("shipped");
  });

  it("returns blocked on BLOCKED + complete", () => {
    writeFile(dir, "review-result.txt", "BLOCKED");
    writeFile(dir, ".bdralph-complete", "");
    expect(deriveStatus(dir)).toBe("blocked");
  });

  it("returns stopped on complete with other result", () => {
    writeFile(dir, "review-result.txt", "REVISE");
    writeFile(dir, ".bdralph-complete", "");
    expect(deriveStatus(dir)).toBe("stopped");
  });
});

describe("buildPipeline", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns all wait when no traces exist", () => {
    // iteration 0 → handled in buildDashboardState, but buildPipeline itself:
    const pipeline = buildPipeline(dir, 1);
    // L1 should be active (first layer, no trace), rest wait
    expect(pipeline[0].state).toBe("active");
    expect(pipeline[1].state).toBe("wait");
    expect(pipeline[2].state).toBe("wait");
    expect(pipeline[3].state).toBe("wait");
  });

  it("marks L1 done, L2 active when only L1 trace exists", () => {
    writeFile(
      dir,
      "traces/l1-iteration-1.json",
      JSON.stringify({ result: "PASS" })
    );
    const pipeline = buildPipeline(dir, 1);
    expect(pipeline[0].state).toBe("done");
    expect(pipeline[1].state).toBe("active");
    expect(pipeline[2].state).toBe("wait");
    expect(pipeline[3].state).toBe("wait");
  });

  it("handles L1 escalation correctly", () => {
    writeFile(
      dir,
      "traces/l1-iteration-1.json",
      JSON.stringify({ result: "SENSITIVE", escalated_to_l4: true })
    );
    const pipeline = buildPipeline(dir, 1);
    expect(pipeline[0].state).toBe("warn");
    expect(pipeline[1].state).toBe("skip");
    expect(pipeline[2].state).toBe("skip");
    expect(pipeline[3].state).toBe("active");
  });

  it("includes provider and cost from traces", () => {
    writeFile(
      dir,
      "traces/l2-iteration-1.json",
      JSON.stringify({
        result: "PASS",
        provider: "openai-cheap",
        cost_usd: 0.0008,
      })
    );
    writeFile(
      dir,
      "traces/l1-iteration-1.json",
      JSON.stringify({ result: "PASS" })
    );
    const pipeline = buildPipeline(dir, 1);
    expect(pipeline[1].provider).toBe("openai-cheap");
    expect(pipeline[1].costUsd).toBe(0.0008);
  });
});
