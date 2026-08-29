import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const runsRoot = path.join(process.cwd(), ".atlas", "runs");

function safeId(value: string) {
  return /^[a-zA-Z0-9_-]{8,100}$/.test(value) ? value : null;
}

async function readRunFiles(runId: string) {
  const days = await fs.readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const events: any[] = [];
  const humanLogs: string[] = [];

  for (const day of days.filter((d) => d.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    const dir = path.join(runsRoot, day.name);
    const jsonl = path.join(dir, `run-${runId}.jsonl`);
    const log = path.join(dir, `run-${runId}.log`);
    const [jsonText, logText] = await Promise.all([
      fs.readFile(jsonl, "utf8").catch(() => ""),
      fs.readFile(log, "utf8").catch(() => ""),
    ]);
    if (jsonText) {
      for (const line of jsonText.split(/\r?\n/).filter(Boolean)) {
        try { events.push(JSON.parse(line)); } catch { /* ignore corrupt line */ }
      }
    }
    if (logText) humanLogs.push(...logText.split(/\r?\n/).filter(Boolean));
  }

  events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  return { runId, events, humanLogs };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("runId");

  if (requested) {
    const runId = safeId(requested);
    if (!runId) return NextResponse.json({ error: "Invalid runId" }, { status: 400 });
    return NextResponse.json(await readRunFiles(runId));
  }

  const days = await fs.readdir(runsRoot, { withFileTypes: true }).catch(() => []);
  const runs = new Map<string, { runId: string; lastTimestamp: string; events: number; status: string }>();

  for (const day of days.filter((d) => d.isDirectory()).sort((a, b) => b.name.localeCompare(a.name))) {
    const files = await fs.readdir(path.join(runsRoot, day.name)).catch(() => []);
    for (const name of files.filter((n) => /^run-[A-Za-z0-9_-]{8,100}\.jsonl$/.test(n))) {
      const runId = name.slice(4, -6);
      const text = await fs.readFile(path.join(runsRoot, day.name, name), "utf8").catch(() => "");
      const lines = text.split(/\r?\n/).filter(Boolean);
      let lastTimestamp = "";
      let status = "RUNNING";
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          lastTimestamp = event.timestamp || lastTimestamp;
          if (event.level === "error" || event.event === "ERROR" || event.event === "FAIL") status = "ERROR";
          if (event.event === "COMPLETE" && event.stage === "REMOTION") status = "COMPLETE";
        } catch { /* ignore */ }
      }
      const previous = runs.get(runId);
      if (!previous || lastTimestamp > previous.lastTimestamp) {
        runs.set(runId, { runId, lastTimestamp, events: lines.length, status });
      }
    }
  }

  return NextResponse.json({ runs: [...runs.values()].sort((a, b) => b.lastTimestamp.localeCompare(a.lastTimestamp)) });
}
