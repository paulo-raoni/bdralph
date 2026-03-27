// gemini.ts — Native Gemini provider for bdralph llm-delegate.
// Called by llm-delegate.sh: npx tsx src/loop/providers/gemini.ts <model> <prompt>
// Writes response text to stdout.
// Writes usage JSON to $TMPDIR/llm_delegate_usage.json.
// Exits 1 on error.

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from "node:fs";
import * as os from "node:os";

const model = process.argv[2];
const prompt = process.argv[3];

if (!model || !prompt) {
  process.stderr.write("Usage: gemini.ts <model> <prompt>\n");
  process.exit(1);
}

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  process.stderr.write("ERROR: GOOGLE_API_KEY is not set\n");
  process.exit(1);
}

const inputPricePerM = parseFloat(process.env.BDRALPH_GEMINI_INPUT_PRICE ?? "0.30");
const outputPricePerM = parseFloat(process.env.BDRALPH_GEMINI_OUTPUT_PRICE ?? "2.50");

try {
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({ model });
  const result = await genModel.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  process.stdout.write(text);

  const usage = response.usageMetadata;
  const inputTokens = usage?.promptTokenCount ?? 0;
  const outputTokens = usage?.candidatesTokenCount ?? 0;
  const cost = (inputTokens * inputPricePerM + outputTokens * outputPricePerM) / 1e6;

  const usageObj = {
    provider: "gemini-sdk",
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: Math.round(cost * 1e9) / 1e9,
  };

  const tmpDir = process.env.TMPDIR || os.tmpdir();
  fs.writeFileSync(`${tmpDir}/llm_delegate_usage.json`, JSON.stringify(usageObj, null, 2) + "\n");
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ERROR: Gemini SDK error: ${msg}\n`);
  process.exit(1);
}
