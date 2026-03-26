import React, { useState, useEffect } from "react";
import { render, Box, Text, type Instance } from "ink";
import { readStateFile, readWorkerLines, formatCost } from "./ralph-ink-helpers.js";

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
}

// TODO: M6 — replace fixed N=10 with dynamic height based on terminal rows
const WORKER_LINES_COUNT = 10;
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
}: {
  prefix: string;
  budget: string;
}) {
  const [state, setState] = useState<PanelState>({
    task: "",
    iteration: "0",
    maxIterations: "0",
    workerMode: "",
    totalCost: "0.00",
    workerState: "waiting",
    workerLines: [],
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
      }));
    }, POLL_INTERVAL_MS);

    return () => clearInterval(stateTimer);
  }, [prefix]);

  useEffect(() => {
    const workerTimer = setInterval(() => {
      setState((prev) => ({
        ...prev,
        workerLines: readWorkerLines(workerOutputFile, WORKER_LINES_COUNT),
      }));
    }, WORKER_POLL_INTERVAL_MS);

    return () => clearInterval(workerTimer);
  }, [workerOutputFile]);

  const cols = Math.max(process.stdout.columns || 80, 60);
  const innerWidth = cols - 4; // box borders + padding

  const headerText = `bdralph  •  Iter ${state.iteration} / ${state.maxIterations}  •  ${state.workerMode}  •  ${elapsed}`;
  const costText = formatCost(state.totalCost, budget);

  return (
    <Box flexDirection="column" width={cols}>
      <Box borderStyle="double" flexDirection="column" paddingX={1}>
        <Text bold>{headerText}</Text>
      </Box>
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text>Task: {state.task.slice(0, innerWidth - 6)}</Text>
      </Box>
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text>{costText}</Text>
      </Box>
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text dimColor>Worker output (last {WORKER_LINES_COUNT} lines):</Text>
        {state.workerLines.length > 0 ? (
          state.workerLines.map((line, i) => (
            <Text key={i}>{"> " + line.slice(0, innerWidth - 2)}</Text>
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

export function startPanel(prefix: string, budget: string): Instance {
  return render(<Panel prefix={prefix} budget={budget} />);
}
