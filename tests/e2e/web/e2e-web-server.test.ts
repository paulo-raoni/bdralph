import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { ChildProcess, spawn } from "node:child_process";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bdralph-smoke-"));
}

function writeFile(dir: string, name: string, content: string): void {
  const filePath = path.join(dir, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function getRandomPort(): number {
  return 10000 + Math.floor(Math.random() * 50000);
}

function fetch(
  url: string,
  options?: { method?: string; body?: string }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
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
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    req.on("error", reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

function waitForServer(port: number, timeoutMs = 5000): Promise<void> {
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
        setTimeout(tryConnect, 100);
      });
    }
    tryConnect();
  });
}

function connectSSE(
  port: number
): { events: string[]; close: () => void; req: http.ClientRequest } {
  const events: string[] = [];
  const req = http.get(`http://localhost:${port}/events`, (res) => {
    let buffer = "";
    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.startsWith("data: ")) {
          events.push(part.slice(6));
        }
      }
    });
  });
  return {
    events,
    close: () => req.destroy(),
    req,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("e2e web server", () => {
  let ralphDir: string;
  let logsDir: string;
  let serverProcess: ChildProcess;
  let port: number;

  beforeEach(async () => {
    ralphDir = makeTmpDir();
    logsDir = makeTmpDir();
    port = getRandomPort();

    // Populate fixture state files
    writeFile(ralphDir, "task.md", "add input validation to TaskService");
    writeFile(ralphDir, "iteration.txt", "2");
    writeFile(
      ralphDir,
      "traces/l1-iteration-2.json",
      JSON.stringify({
        iteration: 2,
        layer: "l1",
        result: "PASS",
        cost_usd: 0,
      })
    );

    const serverPath = path.resolve("src/web/server.ts");
    serverProcess = spawn(
      "node",
      [
        "--import",
        "tsx",
        serverPath,
        "--ralph-dir",
        ralphDir,
        "--port",
        String(port),
        "--logs-dir",
        logsDir,
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          // Prevent auto-open browser in tests
          DISPLAY: "",
        },
      }
    );

    await waitForServer(port);
  });

  afterEach(() => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill("SIGTERM");
    }
    fs.rmSync(ralphDir, { recursive: true, force: true });
    fs.rmSync(logsDir, { recursive: true, force: true });
  });

  it("GET / returns HTTP 200 and Content-Type text/html", async () => {
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("GET / response body contains bdralph", async () => {
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.body).toContain("bdralph");
  });

  it("GET /events returns HTTP 200 and Content-Type text/event-stream", async () => {
    const res = await new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
    }>((resolve) => {
      const req = http.get(`http://localhost:${port}/events`, (res) => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers });
        req.destroy();
      });
    });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
  });

  it("GET /events emits a data: line within 2 seconds", async () => {
    const sse = connectSSE(port);
    await sleep(2000);
    sse.close();
    expect(sse.events.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /events emitted JSON parses to valid DashboardState shape", async () => {
    const sse = connectSSE(port);
    await sleep(1000);
    sse.close();
    expect(sse.events.length).toBeGreaterThanOrEqual(1);
    const state = JSON.parse(sse.events[0]);
    expect(state).toHaveProperty("status");
    expect(state).toHaveProperty("task");
    expect(state).toHaveProperty("iteration");
    expect(state).toHaveProperty("pipeline");
    expect(state).toHaveProperty("workerOutput");
    expect(state.status).toBe("running");
    expect(state.task).toBe("add input validation to TaskService");
  });

  it("POST /stop-now writes operator-signal.json", async () => {
    const res = await fetch(`http://localhost:${port}/stop-now`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const signal = JSON.parse(
      fs.readFileSync(path.join(ralphDir, "operator-signal.json"), "utf-8")
    );
    expect(signal.action).toBe("stop-now");
  });

  it("POST /stop-after-this writes operator-signal.json", async () => {
    const res = await fetch(`http://localhost:${port}/stop-after-this`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const signal = JSON.parse(
      fs.readFileSync(path.join(ralphDir, "operator-signal.json"), "utf-8")
    );
    expect(signal.action).toBe("stop-after-this");
  });

  it('POST /ask writes message to operator-signal.json', async () => {
    const res = await fetch(`http://localhost:${port}/ask`, {
      method: "POST",
      body: "why is this failing?",
    });
    expect(res.status).toBe(200);
    const signal = JSON.parse(
      fs.readFileSync(path.join(ralphDir, "operator-signal.json"), "utf-8")
    );
    expect(signal.action).toBe("message");
    expect(signal.content).toBe("why is this failing?");
  });

  it("handles 3 concurrent SSE clients without error", async () => {
    const clients = [connectSSE(port), connectSSE(port), connectSSE(port)];
    await sleep(1000);
    clients.forEach((c) => c.close());
    for (const client of clients) {
      expect(client.events.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("SSE client receives updated state within 1s after file change", async () => {
    const sse = connectSSE(port);
    await sleep(500); // wait for initial event

    const initialCount = sse.events.length;

    // Modify a state file
    writeFile(ralphDir, "iteration.txt", "3");

    // Wait for SSE push
    await sleep(1000);
    sse.close();

    expect(sse.events.length).toBeGreaterThan(initialCount);
    const latest = JSON.parse(sse.events[sse.events.length - 1]);
    expect(latest.iteration).toBe(3);
  });
});
