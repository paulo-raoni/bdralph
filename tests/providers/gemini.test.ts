import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_SCRIPT = path.resolve(__dirname, "../../src/loop/providers/gemini.ts");

function runGemini(
  args: string[],
  env: Record<string, string> = {}
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync("npx", ["tsx", GEMINI_SCRIPT, ...args], {
    encoding: "utf-8",
    timeout: 10000,
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("gemini.ts provider", () => {

  // T-GEMINI-01: exits 1 when no args provided
  it("T-GEMINI-01: exits 1 when model and prompt are missing", () => {
    const result = runGemini([], { GOOGLE_API_KEY: "dummy" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage");
  });

  // T-GEMINI-02: exits 1 when GOOGLE_API_KEY is not set
  it("T-GEMINI-02: exits 1 when GOOGLE_API_KEY is not set", () => {
    const result = runGemini(["gemini-2.5-flash", "hello"], {
      GOOGLE_API_KEY: "",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("GOOGLE_API_KEY");
  });

});
