import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import * as https from "node:https";
import {
  buildDashboardState,
  buildSecondMindContext,
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

// --- File watcher ---

let watchDebounce: ReturnType<typeof setTimeout> | null = null;
const watchers: fs.FSWatcher[] = [];

function closeAllWatchers(): void {
  for (const w of watchers) {
    try {
      w.close();
    } catch {
      // ignore
    }
  }
  watchers.length = 0;
}

function startFileWatcher(): void {
  // Watch RALPH_DIR for changes
  try {
    const w = fs.watch(ralphDir, { recursive: true }, () => {
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(broadcastState, 300);
    });
    watchers.push(w);
  } catch {
    // Directory might not exist yet — that's fine
  }

  // Watch UI state files if prefix is set
  if (uiStatePrefix) {
    const prefixDir = path.dirname(uiStatePrefix);
    try {
      const w = fs.watch(prefixDir, (_event, filename) => {
        if (
          filename &&
          filename.startsWith(path.basename(uiStatePrefix as string))
        ) {
          if (watchDebounce) clearTimeout(watchDebounce);
          watchDebounce = setTimeout(broadcastState, 300);
        }
      });
      watchers.push(w);
    } catch {
      // TMPDIR watch may fail — non-critical
    }
  }
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

// --- Terminal state fallback poll ---
// fs.watch may miss the final file writes before the loop process exits.
// Poll every 2s to ensure terminal state (shipped/blocked/stopped) reaches clients.
// Once terminal state is broadcast, stop polling and close watchers.

function startTerminalPoll(): void {
  const pollId = setInterval(() => {
    if (sseClients.size === 0) return;
    const opts: BuildStateOptions = { ralphDir };
    if (uiStatePrefix) opts.uiStatePrefix = uiStatePrefix;
    if (logsDir) opts.logsDir = logsDir;
    const state = buildDashboardState(opts);
    const isTerminal =
      state.status === "shipped" ||
      state.status === "blocked" ||
      state.status === "stopped";
    if (isTerminal) {
      const data = JSON.stringify(state);
      for (const client of sseClients) {
        try {
          client.write(`data: ${data}\n\n`);
        } catch {
          sseClients.delete(client);
        }
      }
      // Stop polling and close file watchers — terminal state is final
      clearInterval(pollId);
      closeAllWatchers();
    }
  }, 2000);
}

// --- Read request body ---

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

// --- Anthropic API for Second Mind ---

function callAnthropicAPI(
  apiKey: string,
  question: string,
  context: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system:
        "You are Second Mind, a context-aware advisor for the bdralph agentic loop. " +
        "You have access to the full session context including traces, work summaries, " +
        "and review results. Answer operator questions concisely and helpfully. " +
        "Focus on actionable suggestions.",
      messages: [
        {
          role: "user",
          content: `Context:\n${context}\n\nQuestion: ${question}`,
        },
      ],
    });

    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            const text =
              data.content?.[0]?.text ?? "No response from Second Mind.";
            resolve(text);
          } catch {
            reject(new Error("Failed to parse API response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
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

  // POST /ask — process via Anthropic API directly + signal loop
  if (req.method === "POST" && url.pathname === "/ask") {
    readBody(req).then((question) => {
      // Write signal for the loop (if running, it will pick it up)
      const signalPath = path.join(ralphDir, "operator-signal.json");
      fs.mkdirSync(path.dirname(signalPath), { recursive: true });
      fs.writeFileSync(
        signalPath,
        JSON.stringify({ action: "message", content: question }) + "\n"
      );

      // Process directly via Anthropic API
      const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
      if (!apiKey) {
        const smPath = path.join(ralphDir, "second-mind-response.txt");
        fs.writeFileSync(
          smPath,
          "Second Mind unavailable: ANTHROPIC_API_KEY not set."
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const context = buildSecondMindContext(ralphDir);
      callAnthropicAPI(apiKey, question, context)
        .then((response) => {
          const smPath = path.join(ralphDir, "second-mind-response.txt");
          fs.writeFileSync(smPath, response);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        })
        .catch(() => {
          const smPath = path.join(ralphDir, "second-mind-response.txt");
          fs.writeFileSync(smPath, "Second Mind error: API call failed.");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
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

  startFileWatcher();
  startPingInterval();
  startTerminalPoll();

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
