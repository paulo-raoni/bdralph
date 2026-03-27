import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BIN = path.resolve(__dirname, "../../bin/bdralph");
const LOOP_SCRIPT = path.resolve(__dirname, "../../src/loop/ralph-loop.sh");
const MOCK_DELEGATE = path.resolve(__dirname, "../fixtures/mock-delegate/llm-delegate.sh");

// Helper: run bdralph and capture result
function run(
  args: string[] = [],
  env: Record<string, string> = {}
): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("bash", [BIN, ...args], {
      encoding: "utf-8",
      env: {
        ...process.env,
        // Ensure claude is "found" by default (mock it via PATH override)
        ...env,
      },
      timeout: 10000,
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? "") + (e.stderr ?? ""),
      exitCode: e.status ?? 1,
    };
  }
}

// Helper: run with a fake PATH that includes a mock claude command
function runWithClaude(
  args: string[] = [],
  env: Record<string, string> = {}
): { stdout: string; exitCode: number } {
  const mockDir = path.resolve(__dirname, "../fixtures/mock-bin");
  return run(args, {
    PATH: `${mockDir}:${process.env.PATH ?? ""}`,
    ...env,
  });
}

// Helper: run with a PATH that does NOT include claude
function runWithoutClaude(
  args: string[] = [],
  env: Record<string, string> = {}
): { stdout: string; exitCode: number } {
  return run(args, {
    PATH: "/usr/bin:/bin",
    ...env,
  });
}

// --- Ensure mock claude binary exists ---
import * as fs from "node:fs";

const mockBinDir = path.resolve(__dirname, "../fixtures/mock-bin");
const mockClaude = path.join(mockBinDir, "claude");

if (!fs.existsSync(mockBinDir)) {
  fs.mkdirSync(mockBinDir, { recursive: true });
}
if (!fs.existsSync(mockClaude)) {
  fs.writeFileSync(mockClaude, "#!/bin/bash\nexit 0\n", { mode: 0o755 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI smoke tests", () => {
  // T-01: bdralph --help → exit 0, stdout contains flag names
  it("T-01: --help shows usage with flag names", () => {
    const result = runWithClaude(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--max");
    expect(result.stdout).toContain("--budget");
    expect(result.stdout).toContain("--worker");
    expect(result.stdout).toContain("--escalate-after");
    expect(result.stdout).toContain("--reviewer-mode");
  });

  // T-02: bdralph (no args) → exit 1, stdout contains usage example
  it("T-02: no args prints usage and exits 1", () => {
    const result = runWithClaude([]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Example:");
  });

  // T-03: bdralph --max abc "task" → exit 1, validation error
  it("T-03: --max with non-integer exits 1 with error", () => {
    const result = runWithClaude(["--max", "abc", "task"], {
      BDRALPH_LOOP_MOCK: "1",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("--max");
  });

  // T-04: bdralph hlep → exit 1, suggests help or prints usage
  it("T-04: unknown subcommand prints usage", () => {
    const result = runWithClaude(["hlep"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/usage|Unknown argument/i);
  });

  // T-05: bdralph --mxa 10 "task" → exit 1, suggests --max
  it("T-05: typo flag --mxa suggests --max", () => {
    const result = runWithClaude(["--mxa", "10", "task"], {
      BDRALPH_LOOP_MOCK: "1",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("--max");
  });

  // T-06: bdralph "task" (mocked) → exit 0
  it("T-06: valid task with mock loop exits 0", () => {
    const result = runWithClaude(["test task"], {
      BDRALPH_LOOP_MOCK: "1",
    });
    expect(result.exitCode).toBe(0);
  });

  // T-07: flags passed through to mock loop
  it("T-07: flags passed through to loop", () => {
    const result = runWithClaude(
      ["test task", "--max", "5", "--worker", "opus"],
      { BDRALPH_LOOP_MOCK: "1" }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("max: 5");
    expect(result.stdout).toContain("worker: opus");
  });

  // T-08: BDRALPH_NO_UI=1 bdralph "task" (mocked) → exit 0
  it("T-08: BDRALPH_NO_UI=1 works in mock mode", () => {
    const result = runWithClaude(["test task"], {
      BDRALPH_LOOP_MOCK: "1",
      BDRALPH_NO_UI: "1",
    });
    expect(result.exitCode).toBe(0);
  });

  // T-09: SHIP summary printed
  it("T-09: SHIP mock result includes summary", () => {
    const result = runWithClaude(["test task"], {
      BDRALPH_LOOP_MOCK: "1",
      BDRALPH_MOCK_RESULT: "SHIP",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("SHIPPED");
    expect(result.stdout).toMatch(/iteration/i);
    expect(result.stdout).toContain("$");
  });

  // T-10: BLOCKED summary printed
  it("T-10: BLOCKED mock result includes summary", () => {
    const result = runWithClaude(["test task"], {
      BDRALPH_LOOP_MOCK: "1",
      BDRALPH_MOCK_RESULT: "BLOCKED",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("BLOCKED");
    expect(result.stdout).toMatch(/iteration/i);
    expect(result.stdout).toContain("$");
  });

  // T-11: Claude Code not installed → exit 1, install instruction
  it("T-11: missing claude command shows install instruction", () => {
    const result = runWithoutClaude(["test task"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("install");
  });

  // T-12a: Budget zero via env var → exit 1, budget warning
  it("T-12a: BDRALPH_BUDGET=0 exits with budget warning", () => {
    const result = runWithClaude(["test task"], {
      BDRALPH_BUDGET: "0",
      BDRALPH_LOOP_MOCK: "1",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/budget/i);
  });

  // T-12b: Budget zero via --budget flag → exit 1, budget warning
  it("T-12b: --budget 0 exits with budget warning", () => {
    const result = runWithClaude(["test task", "--budget", "0"], {
      BDRALPH_LOOP_MOCK: "1",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/budget/i);
  });

  // T-13: BDRALPH_NO_UI=1 does not set BDRALPH_INK_UI=1
  it("T-13: BDRALPH_NO_UI=1 does not activate Ink UI", () => {
    const result = runWithClaude(["test task"], {
      BDRALPH_LOOP_MOCK: "1",
      BDRALPH_MOCK_DUMP_ENV: "1",
      BDRALPH_NO_UI: "1",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ink_ui: unset");
  });

  // T-BUG01: bdralph is resolvable as a command via PATH (npm link installed)
  it("T-BUG01: bdralph is resolvable as a command via PATH", () => {
    try {
      const result = execFileSync("which", ["bdralph"], {
        encoding: "utf-8",
        timeout: 5000,
      });
      expect(result.trim()).toBeTruthy();
      expect(result.trim()).toContain("bdralph");
    } catch {
      // which failed — bdralph not in PATH
      // Check npm link fallback: verify the bin field is correct at minimum
      const pkgPath = path.resolve(__dirname, "../../package.json");
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      expect(pkg.bin?.bdralph).toBeDefined();
      // Fail with a clear message
      throw new Error(
        "bdralph is not available in PATH. Run `npm link` to install it globally."
      );
    }
  });

  // T-UI-01: bash UI prints session header with task, worker, budget
  it("T-UI-01: bash UI prints session header", () => {
    const mockDir = path.resolve(__dirname, "../fixtures/mock-bin");
    try {
      const stdout = execFileSync("bash", [LOOP_SCRIPT, "my test task", "--max", "1", "--worker", "sonnet", "--budget", "0.75"], {
        encoding: "utf-8",
        timeout: 15000,
        env: {
          ...process.env,
          PATH: `${mockDir}:${process.env.PATH ?? ""}`,
          BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
          BDRALPH_NO_UI: "1",
          MOCK_LLM_RESPONSE: "PASS",
          MOCK_LLM_CLASSIFICATION: "pass",
        },
      });
      expect(stdout).toContain("bdralph — Governed agentic loops for Claude Code");
      expect(stdout).toContain("my test task");
      expect(stdout).toContain("sonnet");
      expect(stdout).toContain("0.75");
    } catch (err: unknown) {
      const e = err as { stdout?: string };
      const stdout = e.stdout ?? "";
      expect(stdout).toContain("bdralph — Governed agentic loops for Claude Code");
    }
  });

  // T-UI-02: bash UI prints iteration header
  it("T-UI-02: bash UI prints iteration header", () => {
    const mockDir = path.resolve(__dirname, "../fixtures/mock-bin");
    try {
      const stdout = execFileSync("bash", [LOOP_SCRIPT, "test task", "--max", "1"], {
        encoding: "utf-8",
        timeout: 15000,
        env: {
          ...process.env,
          PATH: `${mockDir}:${process.env.PATH ?? ""}`,
          BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
          BDRALPH_NO_UI: "1",
          MOCK_LLM_RESPONSE: "PASS",
          MOCK_LLM_CLASSIFICATION: "pass",
        },
      });
      expect(stdout).toMatch(/Iteration \d+ \/ \d+/);
    } catch (err: unknown) {
      const e = err as { stdout?: string };
      expect((e.stdout ?? "")).toMatch(/Iteration \d+ \/ \d+/);
    }
  });

  // T-UI-03: bash UI prints WORK PHASE start marker
  it("T-UI-03: bash UI prints WORK PHASE start marker", () => {
    const mockDir = path.resolve(__dirname, "../fixtures/mock-bin");
    try {
      const stdout = execFileSync("bash", [LOOP_SCRIPT, "test task", "--max", "1"], {
        encoding: "utf-8",
        timeout: 15000,
        env: {
          ...process.env,
          PATH: `${mockDir}:${process.env.PATH ?? ""}`,
          BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
          BDRALPH_NO_UI: "1",
          MOCK_LLM_RESPONSE: "PASS",
          MOCK_LLM_CLASSIFICATION: "pass",
        },
      });
      expect(stdout).toContain("WORK PHASE");
    } catch (err: unknown) {
      const e = err as { stdout?: string };
      expect((e.stdout ?? "")).toContain("WORK PHASE");
    }
  });

  // T-UI-04: bash UI prints REVIEW PHASE start marker and layer results
  it("T-UI-04: bash UI prints REVIEW PHASE and layer results", () => {
    const mockDir = path.resolve(__dirname, "../fixtures/mock-bin");
    try {
      const stdout = execFileSync("bash", [LOOP_SCRIPT, "test task", "--max", "1"], {
        encoding: "utf-8",
        timeout: 15000,
        env: {
          ...process.env,
          PATH: `${mockDir}:${process.env.PATH ?? ""}`,
          BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
          BDRALPH_NO_UI: "1",
          MOCK_LLM_RESPONSE: "PASS",
          MOCK_LLM_CLASSIFICATION: "pass",
        },
      });
      expect(stdout).toContain("REVIEW PHASE");
      expect(stdout).toContain("L1");
    } catch (err: unknown) {
      const e = err as { stdout?: string };
      const stdout = e.stdout ?? "";
      expect(stdout).toContain("REVIEW PHASE");
      expect(stdout).toContain("L1");
    }
  });

  // T-UI-05: bash UI prints SHIPPED result with cost
  it("T-UI-05: bash UI prints SHIPPED with reviewer cost", () => {
    const mockDir = path.resolve(__dirname, "../fixtures/mock-bin");
    try {
      const stdout = execFileSync("bash", [LOOP_SCRIPT, "test task", "--max", "1"], {
        encoding: "utf-8",
        timeout: 15000,
        env: {
          ...process.env,
          PATH: `${mockDir}:${process.env.PATH ?? ""}`,
          BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
          BDRALPH_NO_UI: "1",
          MOCK_LLM_RESPONSE: "SHIP",
          MOCK_LLM_CLASSIFICATION: "pass",
        },
      });
      expect(stdout).toContain("SHIPPED");
      expect(stdout).toMatch(/\$[\d.]+/);
    } catch (err: unknown) {
      const e = err as { stdout?: string };
      const stdout = e.stdout ?? "";
      expect(stdout).toContain("SHIPPED");
      expect(stdout).toMatch(/\$[\d.]+/);
    }
  });

  // T-14: BDRALPH_BUDGET is exported to the loop
  it("T-14: --budget value is exported as BDRALPH_BUDGET", () => {
    const result = runWithClaude(["test task", "--budget", "1.25"], {
      BDRALPH_LOOP_MOCK: "1",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("budget: 1.25");
  });

  // T-BUG06: bdralph resolves LOOP_SCRIPT correctly when invoked via symlink
  it("T-BUG06: bdralph --help works when invoked via absolute symlink path", () => {
    // Simulate symlink invocation by calling the binary via its npm-global path
    // Falls back to direct invocation if npm link was not run
    const npmGlobalBin = execFileSync("npm", ["prefix", "-g"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim() + "/bin/bdralph";

    const binToUse = fs.existsSync(npmGlobalBin) ? npmGlobalBin : BIN;
    const result = (() => {
      try {
        const stdout = execFileSync("bash", [binToUse, "--help"], {
          encoding: "utf-8",
          timeout: 5000,
          env: { ...process.env },
        });
        return { stdout, exitCode: 0 };
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; status?: number };
        return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), exitCode: e.status ?? 1 };
      }
    })();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--max");
    // Must not contain symlink resolution error
    expect(result.stdout).not.toContain("No such file or directory");
  });
});
