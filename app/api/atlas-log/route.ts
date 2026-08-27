import { NextResponse } from "next/server";
import { atlasRunEvent, writeAtlasRunSummary } from "@/app/lib/atlas/atlas-run-logger";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const runId = String(body?.runId || "").trim();
    const stage = String(body?.stage || "UNKNOWN").trim();
    const event = String(body?.event || "EVENT").trim();
    const level = body?.level === "error" || body?.level === "warn" ? body.level : "info";
    const data = body?.data && typeof body.data === "object" ? body.data : {};

    if (!runId) return NextResponse.json({ error: "runId is required." }, { status: 400 });
    await atlasRunEvent(runId, stage, event, data, level);
    if (stage === "RUN" && event === "END") {
      await writeAtlasRunSummary(runId, { status: "COMPLETE", ...data });
    }
    return NextResponse.json({ ok: true, runId });
  } catch (error: any) {
    // Logging must never take down the ATLAS pipeline.
    console.warn("[ATLAS RUN LOGGER] failed", error?.message || error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
