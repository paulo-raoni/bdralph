import * as fs from "node:fs";
import * as path from "node:path";

export function readTrace(ralphDir: string, filename: string): Record<string, unknown> {
  const full = path.join(ralphDir, "traces", filename);
  return JSON.parse(fs.readFileSync(full, "utf-8"));
}

export function traceExists(ralphDir: string, filename: string): boolean {
  return fs.existsSync(path.join(ralphDir, "traces", filename));
}

export function listTraces(ralphDir: string): string[] {
  const tracesDir = path.join(ralphDir, "traces");
  if (!fs.existsSync(tracesDir)) return [];
  return fs.readdirSync(tracesDir).sort();
}
