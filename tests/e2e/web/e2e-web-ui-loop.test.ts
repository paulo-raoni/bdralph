import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Mode enforcement — must be at the top of every E2E test file
// ---------------------------------------------------------------------------
const mode = process.env.BDRALPH_E2E_MODE;

if (!mode) {
  throw new Error(
    [
      "",
      "BDRALPH_E2E_MODE is not set.",
      "",
      "Run with one of:",
      "  BDRALPH_E2E_MODE=no-llm npm run test:e2e",
      "  BDRALPH_E2E_MODE=with-llm npm run test:e2e",
      "",
      "  no-llm   — fixture-only tests, no Claude Code, no API cost",
      "  with-llm — full loop tests including Claude Code worker (requires auth)",
      "",
    ].join("\n")
  );
}

if (mode !== "no-llm" && mode !== "with-llm") {
  throw new Error(
    `Invalid BDRALPH_E2E_MODE value: "${mode}". Must be "no-llm" or "with-llm".`
  );
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const PLAYGROUND_SRC = path.resolve(repoRoot, "fixtures/playground/src");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

interface DashboardState {
  status: string;
  task: string;
  iteration: number;
  maxIterations: number;
  workerModel: string;
  reviewerCost: number;
  budgetUsd: number;
  elapsedSeconds: number;
  alerts: string[];
  pipeline: Array<{ layer: string; state: string; result?: string }>;
  workerOutput: Array<{ text: string; type: string }>;
  secondMind: Array<{ trigger: string; text: string }>;
  terminalState?: { type: string; message: string };
}

function waitForServer(port: number, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function tryConnect() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Server did not start within timeout"));
        return;
      }
      const req = http.get(`http://localhost:${port}/`, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        setTimeout(tryConnect, 200);
      });
    }
    tryConnect();
  });
}

function connectSSE(
  port: number,
  collectedStates: DashboardState[]
): { close: () => void; req: http.ClientRequest } {
  const req = http.get(`http://localhost:${port}/events`, (res) => {
    let buffer = "";
    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.startsWith("data: ")) {
          try {
            const state = JSON.parse(part.slice(6)) as DashboardState;
            collectedStates.push(state);
          } catch {
            // skip malformed SSE data
          }
        }
      }
    });
  });
  return {
    close: () => req.destroy(),
    req,
  };
}

function httpFetch(
  url: string,
  options?: { method?: string; body?: string }
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const opts: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: options?.method ?? "GET",
    };
    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    req.on("error", reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTerminalStatus(status: string): boolean {
  return status === "shipped" || status === "blocked" || status === "stopped";
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.skipIf(mode !== "with-llm")(
  "Web UI loop integration tests (with-llm)",
  () => {
    let loopProcess: ChildProcess;
    let ralphDir: string;
    let playgroundTmp: string;
    let port: number;
    const collectedStates: DashboardState[] = [];
    let sseHandle: { close: () => void; req: http.ClientRequest };
    let askResult: { status: number; body: string } | null = null;
    let askSignalContent: string | null = null;

    beforeAll(async () => {
      // 1. Copy playground fixtures to tmpdir
      playgroundTmp = fs.mkdtempSync(
        path.join(os.tmpdir(), "bdralph-web-e2e-playground-")
      );
      copyDir(PLAYGROUND_SRC, path.join(playgroundTmp, "src"));

      // 2. Create separate ralph dir for artifacts
      ralphDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "bdralph-web-e2e-ralph-")
      );

      // 3. Random port
      port = 10000 + Math.floor(Math.random() * 50000);

      // 4. Spawn the loop with --web-ui
      loopProcess = spawn(
        "bash",
        [
          "bin/bdralph",
          "add a comment to index.ts",
          "--web-ui",
          "--max",
          "2",
          "--budget",
          "0.10",
        ],
        {
          env: {
            ...process.env,
            BDRALPH_WEB_PORT: String(port),
            BDRALPH_RALPH_DIR: ralphDir,
            DISPLAY: "", // prevent browser auto-open
          },
          cwd: repoRoot,
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      // Collect stdout/stderr for debugging on failure
      loopProcess.stdout?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[loop stdout] ${chunk.toString()}`);
      });
      loopProcess.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`[loop stderr] ${chunk.toString()}`);
      });

      // 5. Wait for server
      await waitForServer(port);

      // 6. Connect SSE and collect states
      sseHandle = connectSSE(port, collectedStates);

      // 7. Wait for a running state, then fire /ask while loop is active
      let askSent = false;
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        await sleep(2000);

        // Send /ask once we see a running state (server is up, loop is active)
        if (
          !askSent &&
          collectedStates.some((s) => s.status === "running")
        ) {
          try {
            askResult = await httpFetch(`http://localhost:${port}/ask`, {
              method: "POST",
              body: "what is the current status?",
            });
            // Read signal file immediately — the loop may consume and delete it
            const signalPath = path.join(ralphDir, "operator-signal.json");
            if (fs.existsSync(signalPath)) {
              askSignalContent = fs.readFileSync(signalPath, "utf-8");
            }
          } catch {
            // server may have shut down between check and request — ok
          }
          askSent = true;
        }

        const lastState = collectedStates[collectedStates.length - 1];
        if (lastState && isTerminalStatus(lastState.status)) {
          // Give a bit more time for final SSE events
          await sleep(3000);
          break;
        }
      }
    }, 300_000);

    afterAll(() => {
      if (sseHandle) sseHandle.close();
      if (loopProcess && !loopProcess.killed) {
        loopProcess.kill("SIGTERM");
      }
      // Wait for process to exit
      if (loopProcess) {
        try {
          loopProcess.on("close", () => {});
        } catch {
          // ignore
        }
      }
      if (ralphDir) fs.rmSync(ralphDir, { recursive: true, force: true });
      if (playgroundTmp)
        fs.rmSync(playgroundTmp, { recursive: true, force: true });
    });

    it(
      "T-WEB-01: SSE emits at least one running state",
      () => {
        const runningStates = collectedStates.filter(
          (s) => s.status === "running"
        );
        expect(runningStates.length).toBeGreaterThan(0);
      },
      300_000
    );

    it(
      "T-WEB-02: Pipeline L1 is activated and reported via SSE",
      () => {
        const l1Active = collectedStates.some(
          (s) => s.pipeline && s.pipeline[0]?.state !== "wait"
        );
        expect(l1Active).toBe(true);
      },
      300_000
    );

    it(
      "T-WEB-03: Loop terminates with a terminal state via SSE",
      () => {
        const terminalState = collectedStates.find((s) =>
          isTerminalStatus(s.status)
        );
        expect(terminalState).toBeDefined();
      },
      300_000
    );

    it(
      "T-WEB-04: .bdralph-complete exists in filesystem after loop",
      () => {
        expect(
          fs.existsSync(path.join(ralphDir, ".bdralph-complete"))
        ).toBe(true);
      },
      300_000
    );

    it(
      "T-WEB-05: review-result.txt contains SHIP or BLOCKED",
      () => {
        const result = fs
          .readFileSync(path.join(ralphDir, "review-result.txt"), "utf-8")
          .trim();
        expect(["SHIP", "BLOCKED"]).toContain(result);
      },
      300_000
    );

    it(
      "T-WEB-06: Terminal SSE state matches review-result.txt",
      () => {
        const terminalSSEState = collectedStates.find((s) =>
          ["shipped", "blocked"].includes(s.status)
        );
        const reviewResult = fs
          .readFileSync(path.join(ralphDir, "review-result.txt"), "utf-8")
          .trim();
        if (reviewResult === "SHIP") {
          expect(terminalSSEState?.status).toBe("shipped");
        } else {
          expect(terminalSSEState?.status).toBe("blocked");
        }
      },
      300_000
    );

    it(
      "T-WEB-07: Second Mind writes a real response (not unavailable)",
      () => {
        const smFile = path.join(ralphDir, "second-mind-response.txt");
        expect(fs.existsSync(smFile)).toBe(true);
        const smContent = fs.readFileSync(smFile, "utf-8").trim();
        expect(smContent.length).toBeGreaterThan(20);
        // Verify it's not a stub/error message (the word "unavailable" may
        // appear in legitimate analysis text, so check start-of-string patterns)
        expect(smContent).not.toMatch(/^unavailable/i);
        expect(smContent).not.toMatch(/^provider error/i);
        expect(smContent).not.toMatch(/^error:/i);
      },
      300_000
    );

    it(
      "T-WEB-08: POST /ask writes correct signal to filesystem",
      () => {
        // /ask was sent during the loop (in beforeAll) while server was alive
        expect(askResult).not.toBeNull();
        expect(askResult!.status).toBe(200);
        // Signal file was captured right after POST — the loop may consume
        // and delete it during its iteration, so we read it eagerly
        expect(askSignalContent).not.toBeNull();
        const signal = JSON.parse(askSignalContent!);
        expect(signal.action).toBe("message");
        expect(signal.content).toBe("what is the current status?");
      },
      300_000
    );
  }
);
