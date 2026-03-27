import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnLoop } from "../helpers/loop-runner";
import { writeSignal } from "../helpers/signal-writer";
import { waitForFile } from "../helpers/file-waiter";
import { traceExists } from "../helpers/trace-reader";

const mode = process.env.BDRALPH_E2E_MODE;
if (!mode) throw new Error("BDRALPH_E2E_MODE is not set. Run with BDRALPH_E2E_MODE=headless-mock");
if (mode !== "headless-mock") throw new Error(`Invalid BDRALPH_E2E_MODE: "${mode}". Expected "headless-mock".`);

describe("E2E-L1 Stop Controls", () => {
  let tmpDir: string;
  let ralphDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-e2e-"));
    ralphDir = path.join(tmpDir, "artifacts/bdralph");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E2E-L1-03: stop --now stops before iteration 2 completes", { timeout: 90000 }, async () => {
    const handle = spawnLoop({
      task: "test task",
      max: 5,
      ralphDir,
      logsDir: tmpDir,
      slowWorker: true,
      extra: ["--reviewer-mode", "pipeline"],
      env: { MOCK_CLAUDE_SLEEP_SECONDS: "2", MOCK_LLM_RESPONSE: "REVISE" },
    });

    // Wait for iteration 1 to start (iteration.txt appears)
    await waitForFile(path.join(ralphDir, "iteration.txt"), 15000);

    // Write stop-now signal while worker is running
    writeSignal(ralphDir, "stop-now");

    const result = await handle.waitForExit(30000);

    expect(result.stdout).toContain("stop-now");
    // Signal check happens at start of each iteration after writing iteration.txt.
    // Iteration 1 completes fully; at start of iteration 2 the loop writes iteration.txt = 2,
    // reads the signal, and breaks immediately. — see ralph-loop.sh:1813-1829
    const iterVal = fs.readFileSync(path.join(ralphDir, "iteration.txt"), "utf-8").trim();
    expect(iterVal).toBe("2");
    // Mock worker does not write work-summary.txt (only real claude does).
    // Loop did not SHIP or reach iteration 3
    expect(result.stdout).not.toContain("SHIPPED");
    expect(traceExists(ralphDir, "l1-iteration-3.json")).toBe(false);
  });

  it("E2E-L1-04: stop --after-this completes current iteration then stops", { timeout: 90000 }, async () => {
    const handle = spawnLoop({
      task: "test task",
      max: 5,
      ralphDir,
      logsDir: tmpDir,
      slowWorker: true,
      extra: ["--reviewer-mode", "pipeline"],
      env: { MOCK_CLAUDE_SLEEP_SECONDS: "2", MOCK_LLM_RESPONSE: "REVISE" },
    });

    // Wait for iteration 1 to start
    await waitForFile(path.join(ralphDir, "iteration.txt"), 15000);

    // Write stop-after-this signal
    writeSignal(ralphDir, "stop-after-this");

    const result = await handle.waitForExit(60000);

    expect(result.stdout).toContain("stop-after-this");
    // Signal is read at start of iteration 2, STOP_AFTER_THIS=true is set,
    // iteration 2 runs to completion, then loop breaks. — see ralph-loop.sh:1831-1834, 2100-2103
    const iterVal = fs.readFileSync(path.join(ralphDir, "iteration.txt"), "utf-8").trim();
    expect(iterVal).toBe("2");
    // stop-after-this with REVISE exits via the BLOCKED path (exit 1)
    // because only SHIP triggers exit 0 — see ralph-loop.sh:2100-2103, 2204
    expect(result.exitCode).not.toBe(0);
    // Loop did not reach iteration 3
    expect(traceExists(ralphDir, "l1-iteration-3.json")).toBe(false);
  });
});
