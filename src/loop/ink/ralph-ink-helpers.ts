import * as fs from "node:fs";

export function readStateFile(
  prefix: string,
  key: string,
  fallback: string
): string {
  const filePath = `${prefix}_${key}.txt`;
  try {
    const content = fs.readFileSync(filePath, "utf-8").trim();
    return content || fallback;
  } catch {
    return fallback;
  }
}

export function readWorkerLines(filePath: string, n: number): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.length > 0);
    return lines.slice(-n);
  } catch {
    return [];
  }
}

export function readFileContent(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}

export function computeWorkerLinesCount(
  totalRows: number,
  hasSecondMind: boolean,
  hasAlerts: boolean
): number {
  // Reserve rows for fixed chrome:
  // - header box: 3 rows
  // - cost line: 1 row
  // - worker output header: 1 row
  // - bottom padding: 2 rows
  const fixedRows = 7;
  // Reserve rows for Second Mind section if active (label + content + padding)
  const smRows = hasSecondMind ? 4 : 0;
  // Reserve rows for alerts section if active
  const alertRows = hasAlerts ? 3 : 0;
  const available = Math.max(4, totalRows - fixedRows - smRows - alertRows);
  return Math.min(available, 20); // cap at 20
}

export function formatCost(totalCost: string, budget: string): string {
  const cost = parseFloat(totalCost) || 0;
  const budgetNum = parseFloat(budget) || 0;
  const remaining = Math.max(0, budgetNum - cost);
  return `Cost: $${cost.toFixed(2)}  •  Budget: $${remaining.toFixed(2)} remaining`;
}
