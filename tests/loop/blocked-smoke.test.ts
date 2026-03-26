import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOOP_SCRIPT = path.resolve(__dirname, "../../src/loop/ralph-loop.sh");
const MOCK_BIN = path.resolve(__dirname, "../fixtures/mock-bin");
const MOCK_DELEGATE = path.resolve(__dirname, "../fixtures/mock-delegate/llm-delegate.sh");
const REPO_ROOT = path.resolve(__dirname, "../..");
const LOGS_DIR = path.join(REPO_ROOT, "logs");

function runLoop(
  task: string,
  extra: string[] = [],
  env: Record<string, string> = {}
): { exitCode: number; stdout: string } {
  try {
    const stdout = execFileSync("bash", [LOOP_SCRIPT, task, ...extra], {
      encoding: "utf-8",
      timeout: 20000,
      env: {
        ...process.env,
        PATH: `${MOCK_BIN}:${process.env.PATH ?? ""}`,
        BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
        BDRALPH_NO_UI: "1",
        MOCK_LLM_RESPONSE: "REVISE: not done",
        MOCK_LLM_CLASSIFICATION: "failure",
        BDRALPH_SM_THRESHOLD: "0",
        ...env,
      },
    });
    return { exitCode: 0, stdout };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { exitCode: e.status ?? 1, stdout: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

describe("BLOCKED path smoke tests", () => {

  // T-BLOCKED-01: loop reports BLOCKED when max iterations reached
  it("T-BLOCKED-01: loop outputs BLOCKED when max iterations exhausted", () => {
    const result = runLoop("test task", ["--max", "1"]);
    expect(result.stdout).toMatch(/BLOCKED/);
  });

  // T-BLOCKED-02: improvement_suggestions.md written on BLOCKED
  it("T-BLOCKED-02: improvement_suggestions.md written after BLOCKED", () => {
    // Remove any stale file first
    const suggestionsFile = path.join(LOGS_DIR, "improvement_suggestions.md");

    runLoop("blocked task test", ["--max", "1"]);

    expect(fs.existsSync(suggestionsFile)).toBe(true);
    const content = fs.readFileSync(suggestionsFile, "utf-8");
    expect(content).toContain("BLOCKED");
    expect(content).toContain("blocked task test");
  });

});
