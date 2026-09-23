import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { RuntimeEnv } from "../runtime-api.js";
import { formatUnknownError } from "./errors.js";
import type { MSTeamsHardRulesDeliveryEvidence } from "./hard-rules-evidence.js";
import type { MSTeamsMonitorLogger } from "./monitor-types.js";

function resolveOpenClawStateDir(): string {
  return process.env.OPENCLAW_STATE_DIR?.trim() || path.join(homedir(), ".openclaw");
}

function safeTimestamp(date = new Date()): string {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

export function createMSTeamsHardRulesEvidenceRecorder(params: {
  runtime: RuntimeEnv;
  log: MSTeamsMonitorLogger;
}): (evidence: MSTeamsHardRulesDeliveryEvidence) => void {
  return (evidence) => {
    const outputDir = path.join(resolveOpenClawStateDir(), "artifacts", "msteams-hard-rules");
    const outputPath = path.join(outputDir, `msteams-hard-rules-delivery-${safeTimestamp()}.json`);
    const payload = JSON.stringify({ recordedAt: new Date().toISOString(), evidence }, null, 2);
    void (async () => {
      try {
        await mkdir(outputDir, { recursive: true });
        await writeFile(outputPath, `${payload}\n`, { flag: "wx", mode: 0o600 });
        params.log.info("msteams hard-rules delivery evidence recorded", { outputPath });
      } catch (error) {
        const message = formatUnknownError(error);
        params.log.warn?.("failed to persist msteams hard-rules delivery evidence", {
          error: message,
          outputPath,
        });
        params.runtime.error?.(
          `failed to persist msteams hard-rules delivery evidence: ${message}`,
        );
      }
    })();
  };
}
