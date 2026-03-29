import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import {
  buildDashboardState,
  type BuildStateOptions,
} from "./state.js";

// --- Argument parsing ---

function getArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const ralphDir = getArg("--ralph-dir", "artifacts/bdralph");
const port = parseInt(
  getArg("--port", process.env.BDRALPH_WEB_PORT ?? "7340"),
  10
);
const uiStatePrefix = getArg("--ui-state-prefix", "") || undefined;
const logsDir = getArg("--logs-dir", "") || undefined;

// --- Dashboard HTML ---

const dashboardPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "dashboard.html"
);

function serveDashboard(): string {
  try {
    return fs.readFileSync(dashboardPath, "utf-8");
  } catch {
    return "<h1>bdralph — dashboard.html not found</h1>";
  }
}

// --- State snapshot ---

function getState(): string {
  const opts: BuildStateOptions = { ralphDir };
  if (uiStatePrefix) opts.uiStatePrefix = uiStatePrefix;
  if (logsDir) opts.logsDir = logsDir;
  const state = buildDashboardState(opts);
  return JSON.stringify(state);
}

// --- SSE clients ---

const sseClients = new Set<http.ServerResponse>();

function broadcastState(): void {
  const data = getState();
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

// --- Unified polling (replaces fs.watch which is unreliable in Linux/Docker) ---

let lastBroadcastedState: string | null = null;
let terminalBroadcastCount = 0;
let pollInterval: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
  if (pollInterval) return;
  pollInterval = setInterval(() => {
    if (sseClients.size === 0) return;
    const data = getState();

    if (data !== lastBroadcastedState) {
      for (const client of sseClients) {
        try {
          client.write(`data: ${data}\n\n`);
        } catch {
          sseClients.delete(client);
        }
      }
      lastBroadcastedState = data;
      terminalBroadcastCount = 0;
    } else {
      // Check if terminal — broadcast a few more times to ensure delivery, then stop
      const state = JSON.parse(data);
      const isTerminal =
        state.status === "shipped" ||
        state.status === "blocked" ||
        state.status === "stopped";
      if (isTerminal) {
        terminalBroadcastCount++;
        if (terminalBroadcastCount <= 3) {
          for (const client of sseClients) {
            try {
              client.write(`data: ${data}\n\n`);
            } catch {
              sseClients.delete(client);
            }
          }
        } else {
          clearInterval(pollInterval!);
          pollInterval = null;
        }
      }
    }
  }, 1500);
}

// --- Keep-alive ping ---

function startPingInterval(): void {
  setInterval(() => {
    for (const client of sseClients) {
      try {
        client.write(": ping\n\n");
      } catch {
        sseClients.delete(client);
      }
    }
  }, 15_000);
}

// --- Read request body ---

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

// --- HTTP server ---

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);

  // CORS headers for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET / — serve dashboard
  if (req.method === "GET" && url.pathname === "/") {
    const html = serveDashboard();
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(html);
    return;
  }

  // GET /events — SSE stream
  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send current state immediately
    const data = getState();
    res.write(`data: ${data}\n\n`);

    sseClients.add(res);

    // Restart polling if stopped (e.g. after terminal state of previous run)
    if (!pollInterval) {
      lastBroadcastedState = null;
      terminalBroadcastCount = 0;
      startPolling();
    }

    req.on("close", () => {
      sseClients.delete(res);
    });
    return;
  }

  // POST /stop-now
  if (req.method === "POST" && url.pathname === "/stop-now") {
    const signalPath = path.join(ralphDir, "operator-signal.json");
    fs.mkdirSync(path.dirname(signalPath), { recursive: true });
    fs.writeFileSync(
      signalPath,
      JSON.stringify({ action: "stop-now" }) + "\n"
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /stop-after-this
  if (req.method === "POST" && url.pathname === "/stop-after-this") {
    const signalPath = path.join(ralphDir, "operator-signal.json");
    fs.mkdirSync(path.dirname(signalPath), { recursive: true });
    fs.writeFileSync(
      signalPath,
      JSON.stringify({ action: "stop-after-this" }) + "\n"
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /ask — write operator signal for the loop to process
  if (req.method === "POST" && url.pathname === "/ask") {
    readBody(req).then((question) => {
      if (question.trim()) {
        const signalPath = path.join(ralphDir, "operator-signal.json");
        fs.mkdirSync(path.dirname(signalPath), { recursive: true });
        fs.writeFileSync(
          signalPath,
          JSON.stringify({ action: "message", content: question }) + "\n"
        );
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

// --- Startup ---

server.listen(port, () => {
  process.stderr.write(`bdralph web UI → http://localhost:${port}\n`);

  startPolling();
  startPingInterval();

  // Auto-open browser (fail silently)
  try {
    const openUrl = `http://localhost:${port}`;
    if (process.platform === "win32") {
      execSync(`start "" "${openUrl}"`, { stdio: "ignore" });
    } else {
      execSync(
        `xdg-open "${openUrl}" 2>/dev/null || open "${openUrl}" 2>/dev/null`,
        { stdio: "ignore" }
      );
    }
  } catch {
    // Browser auto-open is best-effort
  }
});

// --- Graceful shutdown ---

function shutdown(): void {
  for (const client of sseClients) {
    try {
      client.end();
    } catch {
      // ignore
    }
  }
  sseClients.clear();
  server.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// --- Export for testing ---

export { server, port, ralphDir, sseClients, broadcastState, getState };
