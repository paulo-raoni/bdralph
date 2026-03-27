import * as fs from "node:fs";

/** Poll until file exists or timeout. Resolves when file appears. */
export async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
}

/** Poll until file content satisfies predicate or timeout. Returns content. */
export async function waitForFileContent(
  filePath: string,
  predicate: (content: string) => boolean,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (predicate(content)) return content;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for file content: ${filePath}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
