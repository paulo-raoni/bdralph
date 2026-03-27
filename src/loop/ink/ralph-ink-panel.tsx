import React, { useState, useEffect } from "react";
import { render, Box, Text, type Instance } from "ink";
import { createWriteStream, openSync } from "node:fs";
import { readStateFile, readWorkerLines, formatCost, readFileContent, computeWorkerLinesCount } from "./ralph-ink-helpers.js";

// ---------------------------------------------------------------------------
// Panel component
// ---------------------------------------------------------------------------

interface PanelState {
  task: string;
  iteration: string;
  maxIterations: string;
  workerMode: string;
  totalCost: string;
  workerState: string;
  workerLines: string[];
  smResponse: string;
  alerts: string;
}

const POLL_INTERVAL_MS = 150;
const WORKER_POLL_INTERVAL_MS = 200;

function useElapsed(): string {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = Math.floor((now - start) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function Panel({
  prefix,
  budget,
  ralphDir,
}: {
  prefix: string;
  budget: string;
  ralphDir: string;
}) {
  const [state, setState] = useState<PanelState>({
    task: "",
    iteration: "0",
    maxIterations: "0",
    workerMode: "",
    totalCost: "0.00",
    workerState: "waiting",
    workerLines: [],
    smResponse: "",
    alerts: "",
  });

  const elapsed = useElapsed();
  const workerOutputFile = `${prefix}_worker_output.txt`;

  useEffect(() => {
    const stateTimer = setInterval(() => {
      setState((prev) => ({
        ...prev,
        task: readStateFile(prefix, "task", prev.task),
        iteration: readStateFile(prefix, "iteration", prev.iteration),
        maxIterations: readStateFile(prefix, "max_iterations", prev.maxIterations),
        workerMode: readStateFile(prefix, "worker_mode", prev.workerMode),
        totalCost: readStateFile(prefix, "total_cost", prev.totalCost),
        workerState: readStateFile(prefix, "worker_state", prev.workerState),
        smResponse: readFileContent(`${ralphDir}/second-mind-response.txt`),
        alerts: readFileContent(`${ralphDir}/alerts.txt`),
      }));
    }, POLL_INTERVAL_MS);

    return () => clearInterval(stateTimer);
  }, [prefix, ralphDir]);

  useEffect(() => {
    const workerTimer = setInterval(() => {
      setState((prev) => ({
        ...prev,
        workerLines: readWorkerLines(workerOutputFile, 25),
      }));
    }, WORKER_POLL_INTERVAL_MS);
    return () => clearInterval(workerTimer);
  }, [workerOutputFile]);

  const cols = Math.max(
    (process.stdout as NodeJS.WriteStream).columns ||
      parseInt(process.env.COLUMNS || "80", 10),
    40,
  );
  const rows = Math.max(
    (process.stdout as NodeJS.WriteStream).rows ||
      parseInt(process.env.LINES || "24", 10),
    10,
  );

  const minimalist = rows < 15;
  const narrow = cols < 80;

  const hasSecondMind = state.smResponse.length > 0;
  const hasAlerts = state.alerts.length > 0;
  const workerLinesCount = computeWorkerLinesCount(rows, hasSecondMind, hasAlerts);
  const innerWidth = cols - 4;

  // In narrow mode, truncate content more aggressively
  const contentWidth = narrow ? cols - 2 : innerWidth;

  if (minimalist) {
    // <15 rows: single header line only
    return (
      <Box flexDirection="column" width={cols}>
        <Text bold>{`bdralph  •  ${state.iteration}/${state.maxIterations}  •  ${elapsed}`}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={cols}>
      {/* Header */}
      <Box borderStyle="double" flexDirection="column" paddingX={1}>
        <Text bold>
          {`bdralph  •  Iter ${state.iteration} / ${state.maxIterations}  •  ${state.workerMode}  •  ${elapsed}`}
        </Text>
        <Text dimColor>{`Task: ${state.task.slice(0, contentWidth - 6)}`}</Text>
        <Text>{formatCost(state.totalCost, budget)}</Text>
      </Box>

      {/* Alerts section — shown only when content present */}
      {hasAlerts && (
        <Box borderStyle="single" flexDirection="column" paddingX={1}>
          <Text bold color="yellow">⚠ Alerts</Text>
          <Text>{state.alerts.slice(0, contentWidth)}</Text>
        </Box>
      )}

      {/* Second Mind section — shown only when response present */}
      {hasSecondMind && (
        <Box borderStyle="single" flexDirection="column" paddingX={1}>
          <Text bold color="cyan">🧠 Second Mind</Text>
          {state.smResponse
            .split("\n")
            .slice(0, 3)
            .map((line, i) => (
              <Text key={i}>{line.slice(0, contentWidth)}</Text>
            ))}
        </Box>
      )}

      {/* Loop / worker output section */}
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text dimColor>{`Worker output (last ${workerLinesCount} lines):`}</Text>
        {state.workerLines.length > 0 ? (
          state.workerLines.slice(-workerLinesCount).map((line, i) => (
            <Text key={i}>{"> " + line.slice(0, contentWidth - 2)}</Text>
          ))
        ) : (
          <Text dimColor>{"  (waiting for output...)"}</Text>
        )}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main entry — called from ralph-ink.ts
// ---------------------------------------------------------------------------

export function startPanel(
  prefix: string,
  budget: string,
  ralphDir: string,
  stdout?: NodeJS.WriteStream,
): Instance {
  try {
    const output = stdout ?? (() => {
      const ttyFd = openSync("/dev/tty", "w");
      return createWriteStream("/dev/tty", { fd: ttyFd }) as unknown as NodeJS.WriteStream;
    })();

    return render(<Panel prefix={prefix} budget={budget} ralphDir={ralphDir} />, {
      stdout: output,
      patchConsole: false,
      exitOnCtrlC: false,
    });
  } catch (err) {
    process.stderr.write("[bdralph] /dev/tty not accessible — Ink panel cannot start\n");
    throw err;
  }
}
