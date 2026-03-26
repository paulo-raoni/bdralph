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

export function formatCost(totalCost: string, budget: string): string {
  const cost = parseFloat(totalCost) || 0;
  const budgetNum = parseFloat(budget) || 0;
  const remaining = Math.max(0, budgetNum - cost);
  return `Cost: $${cost.toFixed(2)}  •  Budget: $${remaining.toFixed(2)} remaining`;
}
