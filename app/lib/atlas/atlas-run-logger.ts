import { appendFile, mkdir, writeFile } from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";

export type AtlasRunEvent = {
  runId: string;
  timestamp: string;
  elapsedMs?: number;
  stage: string;
  event: string;
  level: "info" | "warn" | "error";
  data?: Record<string, unknown>;
};

const runsRoot = path.join(process.cwd(), ".atlas", "runs");

function safeRunId(value: unknown) {
  const raw = String(value || "").trim();
  if (/^[a-zA-Z0-9_-]{8,100}$/.test(raw)) return raw;
  return crypto.randomUUID();
}

export function getAtlasRunId(request: Request, fallback?: unknown) {
  return safeRunId(
    request.headers.get("x-atlas-run-id") || request.headers.get("x-atlas-runid") || fallback
  );
}

function dayKey(timestamp: string) {
  return timestamp.slice(0, 10);
}

export async function atlasRunEvent(
  runId: string,
  stage: string,
  event: string,
  data: Record<string, unknown> = {},
  level: AtlasRunEvent["level"] = "info",
) {
  const timestamp = new Date().toISOString();
  const normalized = safeRunId(runId);
  const record: AtlasRunEvent = { runId: normalized, timestamp, stage, event, level, data };
  const dir = path.join(runsRoot, dayKey(timestamp));
  await mkdir(dir, { recursive: true });

  const jsonlPath = path.join(dir, `run-${normalized}.jsonl`);
  const logPath = path.join(dir, `run-${normalized}.log`);

  const elapsed = data.__elapsedMs;
  if (typeof elapsed === "number") record.elapsedMs = elapsed;

  const line = JSON.stringify(record);
  const human = `[${timestamp}] [${normalized}] ${level.toUpperCase()} ${stage} ${event}${Object.keys(data).length ? ` | ${formatData(data)}` : ""}`;
  await appendFile(jsonlPath, line + os.EOL, "utf8");
  await appendFile(logPath, human + os.EOL, "utf8");

  // Keep the terminal useful while the user is developing ATLAS.
  console.log(`[ATLAS RUN ${normalized}] ${stage} ${event}${Object.keys(data).length ? ` | ${formatData(data)}` : ""}`);
  return record;
}

function formatData(data: Record<string, unknown>) {
  return Object.entries(data)
    .filter(([key]) => key !== "__elapsedMs")
    .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join(" | ");
}

export async function writeAtlasRunSummary(runId: string, summary: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  const dir = path.join(runsRoot, dayKey(timestamp));
  await mkdir(dir, { recursive: true });
  const normalized = safeRunId(runId);
  const payload = { runId: normalized, generatedAt: timestamp, ...summary };
  await writeFile(path.join(dir, `run-${normalized}-summary.json`), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
