import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// --- Types ---

export interface PipelineLayer {
  layer: "L1" | "L2" | "L3" | "L4";
  state: "done" | "active" | "wait" | "error" | "warn" | "skip";
  result?: string;
  provider?: string;
  model?: string;
  costUsd?: number;
}

export interface WorkerOutputLine {
  text: string;
  type: "normal" | "error" | "warning" | "info";
}

export interface SecondMindMessage {
  trigger: string;
  text: string;
}

export interface TerminalState {
  type: "shipped" | "blocked" | "budget";
  message: string;
  suggestion?: string;
  finalCost?: number;
  finalIterations?: number;
  finalElapsed?: number;
}

export interface DashboardState {
  status: "running" | "shipped" | "blocked" | "stopped" | "idle";
  task: string;
  iteration: number;
  maxIterations: number;
  workerModel: string;
  reviewerCost: number;
  budgetUsd: number;
  elapsedSeconds: number;
  alerts: string[];
  pipeline: PipelineLayer[];
  workerOutput: WorkerOutputLine[];
  secondMind: SecondMindMessage[];
  terminalState?: TerminalState;
}

// --- File reading helpers ---

export function safeReadFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}

export function safeReadJson<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function readUiStateFile(prefix: string, key: string): string {
  if (!prefix) return "";
  return safeReadFile(`${prefix}_${key}.txt`);
}

// --- Worker output classifier ---

export function classifyWorkerLine(line: string): WorkerOutputLine["type"] {
  if (/✗|Error:|FAIL|TypeError|ReferenceError|SyntaxError/.test(line)) {
    return "error";
  }
  if (/⚠|warning|deprecated/i.test(line)) {
    return "warning";
  }
  if (/SHIP|REVISE|escalat/i.test(line)) {
    return "info";
  }
  return "normal";
}

export function classifyWorkerOutput(text: string): WorkerOutputLine[] {
  if (!text) return [];
  return text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => ({
      text: line,
      type: classifyWorkerLine(line),
    }));
}

// --- Trace reading ---

interface TraceFile {
  session_id?: string;
  iteration?: number;
  layer?: string;
  result?: string;
  cost_usd?: number;
  provider?: string;
  feedback?: string;
  escalated_to_l4?: boolean;
  triggered_by?: string;
}

function readTrace(
  ralphDir: string,
  layer: string,
  iteration: number
): TraceFile | null {
  const tracePath = path.join(
    ralphDir,
    "traces",
    `${layer}-iteration-${iteration}.json`
  );
  return safeReadJson<TraceFile>(tracePath);
}

// --- Pipeline builder ---

const LAYER_LABELS: Record<string, string> = {
  l1: "sensitivity",
  l2: "protocol",
  l3: "quality",
  l4: "governance",
};

function mapTraceResult(
  result: string | undefined
): PipelineLayer["state"] {
  if (!result) return "active";
  const upper = result.toUpperCase();
  if (upper === "PASS" || upper === "SHIP" || upper === "CLEAN") return "done";
  if (upper === "REVISE") return "done";
  if (upper === "BLOCKED" || upper === "ERROR" || upper === "FAIL")
    return "error";
  if (upper === "WARN" || upper === "SENSITIVE") return "warn";
  return "done";
}

export function buildPipeline(
  ralphDir: string,
  iteration: number,
  overallStatus?: DashboardState["status"]
): PipelineLayer[] {
  const layers: ("L1" | "L2" | "L3" | "L4")[] = ["L1", "L2", "L3", "L4"];
  const traces: (TraceFile | null)[] = layers.map((l) =>
    readTrace(ralphDir, l.toLowerCase(), iteration)
  );

  // Check for L1 escalation
  const l1Trace = traces[0];
  const l1Escalated = l1Trace?.escalated_to_l4 === true;

  // When the loop has reached a terminal state, read the review result
  // so we can override layers that have no trace file yet.
  const isTerminal =
    overallStatus === "shipped" ||
    overallStatus === "blocked" ||
    overallStatus === "stopped";
  const reviewResult = isTerminal
    ? safeReadFile(path.join(ralphDir, "review-result.txt")).toUpperCase()
    : "";

  const pipeline: PipelineLayer[] = [];
  let foundActive = false;

  for (let i = 0; i < layers.length; i++) {
    const layerName = layers[i];
    const trace = traces[i];
    const layerKey = layerName.toLowerCase();

    let state: PipelineLayer["state"];
    let result: string | undefined = trace?.result;

    if (trace) {
      state = mapTraceResult(trace.result);
    } else if (l1Escalated && (layerKey === "l2" || layerKey === "l3")) {
      state = "skip";
    } else if (isTerminal && !trace) {
      // Terminal state but no trace for this layer — derive from review result
      if (layerKey === "l4" && reviewResult) {
        state = mapTraceResult(reviewResult);
        result = reviewResult;
      } else {
        state = "done";
      }
    } else if (!foundActive) {
      // No trace — determine if this is the active layer.
      // A layer is active if all prior non-skipped layers are resolved.
      const allPriorResolved = layers.slice(0, i).every((_, j) => {
        const priorTrace = traces[j];
        if (priorTrace) return true;
        // Skipped layers count as resolved
        if (
          l1Escalated &&
          (layers[j].toLowerCase() === "l2" ||
            layers[j].toLowerCase() === "l3")
        )
          return true;
        return false;
      });
      if (allPriorResolved) {
        state = "active";
        foundActive = true;
      } else {
        state = "wait";
      }
    } else {
      state = "wait";
    }

    pipeline.push({
      layer: layerName,
      state,
      result,
      provider: trace?.provider ?? undefined,
      costUsd: trace?.cost_usd,
    });
  }

  return pipeline;
}

// --- Cost reading ---

interface CostGuardSession {
  accumulated_usd?: number;
  max_execution_usd?: number;
}

export function readCostFromGuard(): {
  reviewerCost: number;
  budgetUsd: number;
} {
  const tmpDir = os.tmpdir();
  const sessionFile = path.join(tmpDir, "cost_guard_session.json");
  const data = safeReadJson<CostGuardSession>(sessionFile);
  return {
    reviewerCost: data?.accumulated_usd ?? 0,
    budgetUsd: data?.max_execution_usd ?? 0,
  };
}

export function readCostFromReports(logsDir: string): number {
  const reportPath = path.join(logsDir, "iteration_report.jsonl");
  const content = safeReadFile(reportPath);
  if (!content) return 0;
  let total = 0;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      total += record.reviewer_cost_usd ?? record.cost ?? 0;
    } catch {
      // skip malformed lines
    }
  }
  return total;
}

// --- Status derivation ---

export function deriveStatus(
  ralphDir: string
): DashboardState["status"] {
  const completeExists = fs.existsSync(
    path.join(ralphDir, ".bdralph-complete")
  );
  const reviewResult = safeReadFile(
    path.join(ralphDir, "review-result.txt")
  ).toUpperCase();
  const taskExists = fs.existsSync(path.join(ralphDir, "task.md"));

  if (completeExists && reviewResult === "SHIP") return "shipped";
  if (completeExists && reviewResult === "BLOCKED") return "blocked";
  if (completeExists) return "stopped";
  if (taskExists) return "running";
  return "idle";
}

// --- Terminal state builder ---

function buildTerminalState(
  status: DashboardState["status"],
  ralphDir: string,
  iteration: number,
  maxIterations: number,
  reviewerCost: number,
  elapsedSeconds: number
): TerminalState | undefined {
  if (status === "shipped") {
    return {
      type: "shipped",
      message: "SHIPPED — task completed successfully",
      suggestion: "All review layers passed. Changes ready to commit.",
      finalCost: reviewerCost,
      finalIterations: iteration,
      finalElapsed: elapsedSeconds,
    };
  }
  if (status === "blocked") {
    return {
      type: "blocked",
      message: `BLOCKED — max iterations reached without SHIP`,
      suggestion: "Decompose the task or clarify success criteria.",
      finalCost: reviewerCost,
      finalIterations: iteration,
      finalElapsed: elapsedSeconds,
    };
  }
  return undefined;
}

// --- Second Mind ---

function readSecondMind(ralphDir: string): SecondMindMessage[] {
  const smFile = path.join(ralphDir, "second-mind-response.txt");
  const taskFile = path.join(ralphDir, "task.md");
  const content = safeReadFile(smFile);
  if (!content) return [];

  // Only include if SM response is newer than session start (task.md mtime)
  try {
    const taskMtime = fs.existsSync(taskFile)
      ? fs.statSync(taskFile).mtimeMs
      : 0;
    const smMtime = fs.statSync(smFile).mtimeMs;
    if (taskMtime > 0 && smMtime < taskMtime) return [];
  } catch {
    // If stat fails, include the response anyway
  }

  return [{ trigger: "second mind", text: content }];
}

// --- Second Mind context builder (exported for server API use) ---

export function buildSecondMindContext(ralphDir: string): string {
  const parts: string[] = [];

  const task = safeReadFile(path.join(ralphDir, "task.md"));
  if (task) parts.push(`Task: ${task}`);

  const iterLog = safeReadFile(path.join(ralphDir, "iteration-log.json"));
  if (iterLog) parts.push(`Last iteration log: ${iterLog}`);

  const summary = safeReadFile(path.join(ralphDir, "work-summary.txt"));
  if (summary) {
    const lines = summary.split("\n").slice(-50).join("\n");
    parts.push(`Work summary (last 50 lines):\n${lines}`);
  }

  const iterStr = safeReadFile(path.join(ralphDir, "iteration.txt"));
  const iteration = parseInt(iterStr, 10) || 0;
  if (iteration > 0) {
    for (const layer of ["l1", "l2", "l3", "l4"]) {
      const traceFile = path.join(
        ralphDir,
        "traces",
        `${layer}-iteration-${iteration}.json`
      );
      const traceContent = safeReadFile(traceFile);
      if (traceContent) {
        parts.push(`Trace ${layer.toUpperCase()} (iteration ${iteration}): ${traceContent}`);
      }
    }
  }

  const result = safeReadFile(path.join(ralphDir, "review-result.txt"));
  if (result) parts.push(`Review result: ${result}`);

  const feedback = safeReadFile(path.join(ralphDir, "review-feedback.txt"));
  if (feedback) parts.push(`Review feedback: ${feedback}`);

  return parts.join("\n\n");
}

// --- Main state builder ---

export interface BuildStateOptions {
  ralphDir: string;
  logsDir?: string;
  uiStatePrefix?: string;
}

export function buildDashboardState(
  opts: BuildStateOptions
): DashboardState {
  const { ralphDir, uiStatePrefix } = opts;
  const logsDir = opts.logsDir ?? path.join(ralphDir, "..", "..", "logs");

  // Status
  const status = deriveStatus(ralphDir);

  // Task
  const task =
    readUiStateFile(uiStatePrefix ?? "", "task") ||
    safeReadFile(path.join(ralphDir, "task.md"));

  // Iteration
  const iterStr =
    readUiStateFile(uiStatePrefix ?? "", "iteration") ||
    safeReadFile(path.join(ralphDir, "iteration.txt"));
  const iteration = parseInt(iterStr, 10) || 0;

  // Max iterations
  const maxIterStr = readUiStateFile(uiStatePrefix ?? "", "max_iterations");
  const maxIterations = parseInt(maxIterStr, 10) || 0;

  // Worker model
  const workerModel =
    readUiStateFile(uiStatePrefix ?? "", "worker_mode") || "unknown";

  // Cost
  const uiCostStr = readUiStateFile(uiStatePrefix ?? "", "total_cost");
  let reviewerCost: number;
  let budgetUsd: number;

  if (uiCostStr !== "") {
    // UI state has an explicit cost value (even "0") — trust it for this session
    reviewerCost = parseFloat(uiCostStr) || 0;
    const costGuard = readCostFromGuard();
    budgetUsd = costGuard.budgetUsd;
  } else {
    const costGuard = readCostFromGuard();
    reviewerCost = costGuard.reviewerCost;
    budgetUsd = costGuard.budgetUsd;
    // Only fall back to reports when no UI state is available (non-UI mode)
    if (reviewerCost === 0) {
      const fromReports = readCostFromReports(logsDir);
      if (fromReports > 0) reviewerCost = fromReports;
    }
  }

  // Elapsed
  const elapsedStr = readUiStateFile(uiStatePrefix ?? "", "session_elapsed");
  const elapsedSeconds = parseInt(elapsedStr, 10) || 0;

  // Alerts
  const alerts: string[] = [];
  const bannerMsg = readUiStateFile(uiStatePrefix ?? "", "banner_message");
  if (bannerMsg) alerts.push(bannerMsg);

  // Pipeline
  const pipeline = iteration > 0 ? buildPipeline(ralphDir, iteration, status) : [
    { layer: "L1" as const, state: "wait" as const },
    { layer: "L2" as const, state: "wait" as const },
    { layer: "L3" as const, state: "wait" as const },
    { layer: "L4" as const, state: "wait" as const },
  ];

  // Worker output — use worker output file (appends across iterations) as
  // primary source, with fallbacks for non-UI and trace-only modes.
  let workerOutputText = "";
  // 1. UI state prefix worker output (accumulates across iterations via tee -a)
  if (uiStatePrefix) {
    workerOutputText = safeReadFile(`${uiStatePrefix}_worker_output.txt`);
  }
  // 2. Fallback: work-summary.txt in RALPH_DIR
  if (!workerOutputText) {
    workerOutputText = safeReadFile(path.join(ralphDir, "work-summary.txt"));
  }
  // 3. Fallback: build from trace feedback
  if (!workerOutputText && iteration > 0) {
    const traceParts: string[] = [];
    for (const layer of ["l1", "l2", "l3", "l4"]) {
      const traceFile = path.join(
        ralphDir,
        "traces",
        `${layer}-iteration-${iteration}.json`
      );
      const trace = safeReadJson<{ feedback?: string; result?: string }>(
        traceFile
      );
      if (trace?.feedback) {
        traceParts.push(
          `${layer.toUpperCase()}: ${trace.result ?? ""} — ${trace.feedback}`
        );
      }
    }
    workerOutputText = traceParts.join("\n");
  }
  const workerOutput = classifyWorkerOutput(workerOutputText);

  // Second Mind
  const secondMind = readSecondMind(ralphDir);

  // Terminal state
  const terminalState = buildTerminalState(
    status,
    ralphDir,
    iteration,
    maxIterations,
    reviewerCost,
    elapsedSeconds
  );

  return {
    status,
    task,
    iteration,
    maxIterations,
    workerModel,
    reviewerCost,
    budgetUsd,
    elapsedSeconds,
    alerts,
    pipeline,
    workerOutput,
    secondMind,
    terminalState,
  };
}
