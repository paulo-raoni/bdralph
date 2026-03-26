import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  readStateFile,
  readWorkerLines,
  formatCost,
} from "../../src/loop/ink/ralph-ink-helpers.js";

let tmpDir: string;
let prefix: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ink-test-"));
  prefix = path.join(tmpDir, "ralph_ui_test");

  // Write minimal state files
  fs.writeFileSync(`${prefix}_iteration.txt`, "1");
  fs.writeFileSync(`${prefix}_max_iterations.txt`, "10");
  fs.writeFileSync(`${prefix}_worker_mode.txt`, "sonnet");
  fs.writeFileSync(`${prefix}_total_cost.txt`, "0.00");
  fs.writeFileSync(`${prefix}_task.txt`, "test task");
  fs.writeFileSync(`${prefix}_worker_state.txt`, "waiting");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Ink panel helpers", () => {
  // INK-01: readStateFile returns file content when file exists
  it("INK-01: readStateFile returns content when file exists", () => {
    expect(readStateFile(prefix, "iteration", "0")).toBe("1");
  });

  // INK-02: readStateFile returns fallback when file does not exist
  it("INK-02: readStateFile returns fallback when file does not exist", () => {
    expect(readStateFile(prefix, "nonexistent", "fallback")).toBe("fallback");
  });

  // INK-03: readWorkerLines returns last 10 lines of a file with 15 lines
  it("INK-03: readWorkerLines returns last N lines when file has more", () => {
    const lines = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`);
    const outputFile = `${prefix}_worker_output.txt`;
    fs.writeFileSync(outputFile, lines.join("\n") + "\n");

    const result = readWorkerLines(outputFile, 10);
    expect(result).toHaveLength(10);
    expect(result[0]).toBe("line 6");
    expect(result[9]).toBe("line 15");
  });

  // INK-04: readWorkerLines returns all lines when fewer than N
  it("INK-04: readWorkerLines returns all lines when fewer than N", () => {
    const lines = ["alpha", "beta", "gamma"];
    const outputFile = `${prefix}_worker_output.txt`;
    fs.writeFileSync(outputFile, lines.join("\n") + "\n");

    const result = readWorkerLines(outputFile, 10);
    expect(result).toHaveLength(3);
    expect(result).toEqual(["alpha", "beta", "gamma"]);
  });

  // INK-05: readWorkerLines returns empty array when file does not exist
  it("INK-05: readWorkerLines returns empty array for missing file", () => {
    const result = readWorkerLines(`${prefix}_nonexistent.txt`, 10);
    expect(result).toEqual([]);
  });

  // INK-06: formatCost returns string with cost and remaining budget
  it("INK-06: formatCost returns formatted cost and remaining budget", () => {
    const result = formatCost("0.08", "0.50");
    expect(result).toContain("$0.08");
    expect(result).toContain("$0.42");
  });
});
