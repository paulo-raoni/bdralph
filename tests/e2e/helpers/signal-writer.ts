import * as fs from "node:fs";
import * as path from "node:path";

export function writeSignal(ralphDir: string, action: string): void {
  fs.mkdirSync(ralphDir, { recursive: true });
  fs.writeFileSync(
    path.join(ralphDir, "operator-signal.json"),
    JSON.stringify({ action, timestamp: new Date().toISOString() })
  );
}

export function writeMessage(ralphDir: string, content: string): void {
  fs.mkdirSync(ralphDir, { recursive: true });
  fs.writeFileSync(
    path.join(ralphDir, "operator-signal.json"),
    JSON.stringify({ action: "message", content, timestamp: new Date().toISOString() })
  );
}
