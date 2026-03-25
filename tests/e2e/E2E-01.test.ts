import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Mode enforcement — must be at the top of every E2E test file
// ---------------------------------------------------------------------------
const mode = process.env.BDRALPH_E2E_MODE;

if (!mode) {
  throw new Error(
    [
      "",
      "❌ BDRALPH_E2E_MODE is not set.",
      "",
      "Run with one of:",
      "  BDRALPH_E2E_MODE=no-llm npm run test:e2e",
      "  BDRALPH_E2E_MODE=with-llm npm run test:e2e",
      "",
      "  no-llm   — fixture-only tests, no Claude Code, no API cost",
      "  with-llm — full loop tests including Claude Code worker (requires auth)",
      "",
    ].join("\n")
  );
}

if (mode !== "no-llm" && mode !== "with-llm") {
  throw new Error(
    `❌ Invalid BDRALPH_E2E_MODE value: "${mode}". Must be "no-llm" or "with-llm".`
  );
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURE_ROOT = path.resolve(__dirname, "../../fixtures/e2e/e2e-01");
const PLAYGROUND_SRC = path.resolve(
  __dirname,
  "../../fixtures/playground/src"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function removeDir(dir: string): void {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
beforeAll(() => {
  // Clean slate — remove any leftover from a previous failed run
  removeDir(FIXTURE_ROOT);

  // Create fresh fixture from playground src
  copyDir(PLAYGROUND_SRC, path.join(FIXTURE_ROOT, "src"));
});

afterAll(() => {
  removeDir(FIXTURE_ROOT);
});

// ---------------------------------------------------------------------------
// Tests (no-llm mode — fixture infrastructure only)
// ---------------------------------------------------------------------------
describe("E2E-01 — fixture infrastructure (no-llm mode)", () => {
  it("fixture directory was created", () => {
    expect(fs.existsSync(FIXTURE_ROOT)).toBe(true);
  });

  it("fixture contains src/", () => {
    expect(fs.existsSync(path.join(FIXTURE_ROOT, "src"))).toBe(true);
  });

  it("fixture contains TaskService without input validation (degraded state)", () => {
    const taskServicePath = path.join(
      FIXTURE_ROOT,
      "src/services/TaskService.ts"
    );
    expect(fs.existsSync(taskServicePath)).toBe(true);

    const content = fs.readFileSync(taskServicePath, "utf-8");

    // Degraded state: createTask accepts any title without validation
    // The worker's job (in with-llm mode) will be to add this validation
    expect(content).not.toMatch(/throw.*empty/i);
    expect(content).not.toMatch(/throw.*too long/i);
    expect(content).not.toMatch(/title\.length/);
  });

  it("fixture contains TaskRepository", () => {
    expect(
      fs.existsSync(path.join(FIXTURE_ROOT, "src/repositories/TaskRepository.ts"))
    ).toBe(true);
  });

  it("fixture contains Task type", () => {
    expect(
      fs.existsSync(path.join(FIXTURE_ROOT, "src/types/Task.ts"))
    ).toBe(true);
  });

  it("fixture can be destroyed and recreated deterministically", () => {
    // Destroy
    removeDir(FIXTURE_ROOT);
    expect(fs.existsSync(FIXTURE_ROOT)).toBe(false);

    // Recreate
    copyDir(PLAYGROUND_SRC, path.join(FIXTURE_ROOT, "src"));
    expect(fs.existsSync(FIXTURE_ROOT)).toBe(true);
    expect(
      fs.existsSync(path.join(FIXTURE_ROOT, "src/services/TaskService.ts"))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// with-llm mode placeholder (M1b+)
// ---------------------------------------------------------------------------
describe.skipIf(mode !== "with-llm")(
  "E2E-01 — full loop (with-llm mode)",
  () => {
    it("placeholder — loop implementation in M1b+", () => {
      // Full loop execution tests will be added once bdralph CLI is available
      expect(true).toBe(true);
    });
  }
);
