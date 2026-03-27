import { execFileSync, spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LOOP_SCRIPT = path.resolve(__dirname, "../../../src/loop/ralph-loop.sh");
export const MOCK_BIN = path.resolve(__dirname, "../../fixtures/mock-bin");
export const SLOW_MOCK_BIN = path.resolve(__dirname, "../../fixtures/mock-bin-slow");
export const MOCK_DELEGATE = path.resolve(__dirname, "../../fixtures/mock-delegate/llm-delegate.sh");
export const MOCK_DELEGATE_SEQ = path.resolve(__dirname, "../../fixtures/mock-delegate/llm-delegate-sequence.sh");

export interface RunLoopOpts {
  task: string;
  max?: number;
  extra?: string[];
  env?: Record<string, string>;
  timeout?: number;
  ralphDir: string;
  logsDir?: string;
}

export interface RunLoopResult {
  exitCode: number;
  stdout: string;
}

/** Synchronous loop run. Use for tests that don't need timing control. */
export function runLoop(opts: RunLoopOpts): RunLoopResult {
  const { task, max = 3, extra = [], env = {}, timeout = 30000, ralphDir, logsDir } = opts;
  try {
    const stdout = execFileSync(
      "bash",
      [LOOP_SCRIPT, task, "--max", String(max), ...extra],
      {
        encoding: "utf-8",
        timeout,
        env: {
          ...process.env,
          PATH: `${MOCK_BIN}:${process.env.PATH ?? ""}`,
          BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
          BDRALPH_NO_UI: "1",
          MOCK_LLM_RESPONSE: "SHIP",
          BDRALPH_RALPH_DIR: ralphDir,
          BDRALPH_LOGS_DIR: logsDir ?? ralphDir,
          ...env,
        },
      }
    );
    return { exitCode: 0, stdout };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { exitCode: e.status ?? 1, stdout: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

export interface LoopHandle {
  proc: ChildProcess;
  stdout: string;
  waitForExit(timeoutMs?: number): Promise<RunLoopResult>;
  kill(): void;
}

/** Async loop spawn. Use for stop-control tests that need timing. */
export function spawnLoop(opts: RunLoopOpts & { slowWorker?: boolean }): LoopHandle {
  const {
    task,
    max = 5,
    extra = [],
    env = {},
    ralphDir,
    logsDir,
    slowWorker = false,
  } = opts;

  const mockBin = slowWorker ? SLOW_MOCK_BIN : MOCK_BIN;

  const proc = spawn(
    "bash",
    [LOOP_SCRIPT, task, "--max", String(max), ...extra],
    {
      env: {
        ...process.env,
        PATH: `${mockBin}:${process.env.PATH ?? ""}`,
        BDRALPH_LLM_DELEGATE: MOCK_DELEGATE,
        BDRALPH_NO_UI: "1",
        MOCK_LLM_RESPONSE: "REVISE",
        BDRALPH_RALPH_DIR: ralphDir,
        BDRALPH_LOGS_DIR: logsDir ?? ralphDir,
        ...env,
      },
    }
  );

  let stdout = "";
  proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  proc.stderr?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });

  const handle: LoopHandle = {
    proc,
    get stdout() { return stdout; },
    waitForExit(timeoutMs = 60000): Promise<RunLoopResult> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error(`Loop did not exit within ${timeoutMs}ms`));
        }, timeoutMs);
        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve({ exitCode: code ?? 1, stdout });
        });
      });
    },
    kill() { proc.kill("SIGTERM"); },
  };

  return handle;
}
