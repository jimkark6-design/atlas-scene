import { appendFile, mkdir, writeFile, readFile, access } from "fs/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { syncAtlasRunSnapshot } from "./atlas-run-remote";

const execFileAsync = promisify(execFile);

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
    request.headers.get("x-atlas-run-id") || request.headers.get("x-atlas-runid") || fallback,
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

async function git(cwd: string, args: string[], maxBuffer = 4 * 1024 * 1024) {
  return execFileAsync("git", args, { cwd, maxBuffer });
}

/**
 * Publishes the exact runtime trace for one render. The preferred path is the
 * direct GitHub Contents API snapshot; local git sync remains as a fallback.
 */
export async function syncAtlasRunToGit(runId: string, timestamp = new Date().toISOString()) {
  if (String(process.env.ATLAS_RUN_SYNC_TO_GIT || "true").toLowerCase() !== "true") {
    return { enabled: false, synced: false, reason: "disabled" };
  }

  const normalized = safeRunId(runId);
  const day = dayKey(timestamp);
  const relativeDir = path.join(".atlas", "runs", day);
  const absoluteDir = path.join(process.cwd(), relativeDir);
  const names = [
    `run-${normalized}.jsonl`,
    `run-${normalized}.log`,
    `run-${normalized}-summary.json`,
  ];

  let localResult: any = { enabled: true, synced: false, reason: "not-attempted" };
  try {
    await mkdir(absoluteDir, { recursive: true });
    const existing: string[] = [];
    for (const name of names) {
      const file = path.join(absoluteDir, name);
      try { await access(file); existing.push(file); } catch { /* optional file */ }
    }
    if (existing.length) {
      const relativeFiles = existing.map((file) => path.relative(process.cwd(), file));
      await git(process.cwd(), ["add", "-f", ...relativeFiles]);
      let staged = true;
      try {
        await git(process.cwd(), ["diff", "--cached", "--quiet", "--exit-code"]);
        staged = false;
      } catch { staged = true; }
      if (staged) {
        const commit = await git(process.cwd(), [
          "-c", "user.name=ATLAS Run Logger",
          "-c", "user.email=atlas-run-logger@local",
          "commit", "-m", `ATLAS run ${normalized} diagnostics`, "--no-verify",
        ]);
        try {
          const push = await git(process.cwd(), ["push", "origin", "HEAD:main"]);
          localResult = { enabled: true, synced: true, path: path.join(relativeDir, names[0]), commit: commit.stdout?.trim() || undefined, push: push.stdout?.trim() || undefined };
        } catch (pushError: any) {
          localResult = { enabled: true, synced: false, reason: `push-failed: ${pushError?.stderr || pushError?.message || String(pushError)}`, commit: commit.stdout?.trim() || undefined };
        }
      } else {
        localResult = { enabled: true, synced: false, reason: "no-changes", path: relativeFiles[0] };
      }
    } else {
      localResult = { enabled: true, synced: false, reason: "no-run-files" };
    }
  } catch (error: any) {
    localResult = { enabled: true, synced: false, reason: error?.stderr || error?.message || String(error) };
  }

  let snapshot: any = null;
  try {
    const [jsonl, log, summaryText] = await Promise.all([
      readFile(path.join(absoluteDir, names[0]), "utf8").catch(() => ""),
      readFile(path.join(absoluteDir, names[1]), "utf8").catch(() => ""),
      readFile(path.join(absoluteDir, names[2]), "utf8").catch(() => ""),
    ]);
    snapshot = {
      version: "ATLAS-RUN-SNAPSHOT-V1",
      runId: normalized,
      day,
      generatedAt: new Date().toISOString(),
      jsonl,
      log,
      summary: summaryText ? JSON.parse(summaryText) : null,
    };
  } catch (error: any) {
    console.warn(`[ATLAS RUN ${normalized}] REMOTE_SNAPSHOT BUILD WARN | ${error?.message || String(error)}`);
  }

  if (snapshot) {
    try {
      const remoteResult = await syncAtlasRunSnapshot(normalized, snapshot);
      if (remoteResult.synced) {
        return { ...remoteResult, local: localResult };
      }
      return { ...localResult, remote: remoteResult, reason: localResult.synced ? undefined : `remote: ${remoteResult.reason}; local: ${localResult.reason}` };
    } catch (error: any) {
      return { ...localResult, remote: { enabled: true, synced: false, reason: error?.message || String(error) }, reason: localResult.synced ? undefined : localResult.reason };
    }
  }

  return localResult;
}

export async function readAtlasRun(runId: string, timestamp = new Date().toISOString()) {
  const normalized = safeRunId(runId);
  const dir = path.join(runsRoot, dayKey(timestamp));
  const base = path.join(dir, `run-${normalized}`);
  const [jsonl, log, summary] = await Promise.all([
    readFile(`${base}.jsonl`, "utf8").catch(() => ""),
    readFile(`${base}.log`, "utf8").catch(() => ""),
    readFile(`${base}-summary.json`, "utf8").catch(() => ""),
  ]);
  return { runId: normalized, jsonl, log, summary: summary ? JSON.parse(summary) : null };
}
