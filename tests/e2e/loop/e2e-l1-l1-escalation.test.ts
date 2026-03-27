import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runLoop, MOCK_BIN } from "../helpers/loop-runner";
import { readTrace, traceExists } from "../helpers/trace-reader";

const mode = process.env.BDRALPH_E2E_MODE;
if (!mode) throw new Error("BDRALPH_E2E_MODE is not set. Run with BDRALPH_E2E_MODE=headless-mock");
if (mode !== "headless-mock") throw new Error(`Invalid BDRALPH_E2E_MODE: "${mode}". Expected "headless-mock".`);

describe("E2E-L1 L1 Escalation", () => {
  let tmpDir: string;
  let ralphDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-e2e-"));
    ralphDir = path.join(tmpDir, "artifacts/bdralph");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("E2E-L1-06: L1 sensitive path detection escalates to L4", () => {
    // Create a temporary mock git that returns a sensitive path in diff output
    const mockGitSensitive = path.join(tmpDir, "mock-git-sensitive");
    fs.mkdirSync(mockGitSensitive);
    const gitScript = `#!/bin/bash
case "$1" in
  diff) echo "CLAUDE.md" ;;
  ls-files) echo "" ;;
  *) exec /usr/bin/git "$@" ;;
esac
`;
    fs.writeFileSync(path.join(mockGitSensitive, "git"), gitScript, { mode: 0o755 });

    const result = runLoop({
      task: "test task",
      max: 1,
      ralphDir,
      logsDir: tmpDir,
      extra: ["--reviewer-mode", "pipeline"],
      env: {
        PATH: `${mockGitSensitive}:${MOCK_BIN}:${process.env.PATH ?? ""}`,
        MOCK_LLM_RESPONSE: "SHIP",
        MOCK_LLM_CLASSIFICATION: "pass",
      },
    });

    // L1 should detect sensitive path and escalate
    expect(result.stdout).toMatch(/sensitive|L1|escalat/i);
    // L1 trace should exist with escalated_to_l4: true
    expect(traceExists(ralphDir, "l1-iteration-1.json")).toBe(true);
    const trace = readTrace(ralphDir, "l1-iteration-1.json");
    expect(trace.escalated_to_l4).toBe(true);
  });
});
