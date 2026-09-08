import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { renderAtlasWithRemotion } from "@/app/lib/atlas/remotion-engine";
import { designAndGenerateSfx } from "@/app/lib/atlas/sfx-director";
import { validateExecutableTimeline } from "@/app/lib/atlas/atlas-edit-contract";
import { normalizeAtlasEditPlan } from "@/app/lib/atlas/atlas-edit-normalizer";
import { atlasPlanToRemotionShots } from "@/app/lib/atlas/atlas-remotion-adapter";
import { atlasRunEvent, getAtlasRunId, syncAtlasRunToGit, writeAtlasRunSummary } from "@/app/lib/atlas/atlas-run-logger";

export const runtime = "nodejs";

type TimelineBeat = {
  id?: string; source_filename: string; source_start: number; source_end: number;
  role?: string; purpose?: string; cut_reason?: string; transition_in?: string; transition_out?: string;
  motion?: string; zoom_start?: number; zoom_end?: number; speed?: number;
  speed_curve?: Array<{at?: number; speed?: number}>; text?: string; text_style?: string;
  text_animation?: string; text_position?: string; emphasis_words?: string[]; sfx?: string[];
  sfx_events?: Array<{ type?: string; at?: number; volume?: number }>; beat_intent?: string; cut_on?: string;
  source_audio_volume?: number; music_volume?: number; music_curve?: Array<{at?: number; level?: number}>;
  color_treatment?: string; crop_focus?: string; editorial_score?: number;
};

function createReviewId() { return `${Date.now().toString(16)}-${crypto.randomUUID().replace(/-/g, "")}`; }
export async function POST(request: NextRequest) {
  const runId = getAtlasRunId(request); const startedAt = Date.now();
  try {
    await atlasRunEvent(runId, "REMOTION", "START", {});
    console.log("================================"); console.log("ATLAS PRO EDITOR V2 — REMOTION"); console.log("================================");
    const formData = await request.formData();
    const files = formData.getAll("clips").filter((value): value is File => value instanceof File);
    if (!files.length) return NextResponse.json({ error: "No video clips were uploaded." }, { status: 400 });
    const timelineRaw = formData.get("editTimeline");
    if (typeof timelineRaw !== "string") return NextResponse.json({ error: "No executable editTimeline was supplied." }, { status: 400 });
    let parsedTimeline: any = null;
    try { parsedTimeline = JSON.parse(timelineRaw); } catch { return NextResponse.json({ error: "editTimeline is not valid JSON." }, { status: 400 }); }
   const rawTimeline: TimelineBeat[] =
  Array.isArray(parsedTimeline)
    ? parsedTimeline
    : Array.isArray(parsedTimeline?.timeline)
      ? parsedTimeline.timeline
      : [];

if (rawTimeline.length < 1) {
  return NextResponse.json(
    { error: "Executable editTimeline contains no beats." },
    { status: 400 },
  );
}

const uploadedNames = new Set(
  files.map((file) => file.name),
);

const filteredTimeline = rawTimeline.filter(
  (beat) =>
    uploadedNames.has(
      String(beat.source_filename || ""),
    ),
);

if (!filteredTimeline.length) {
  return NextResponse.json(
    {
      error:
        "None of the Edit Director timeline sources match uploaded clips.",
    },
    { status: 400 },
  );
}

const clipAnalysesRaw = formData.get("clipAnalyses");

let clipAnalyses: Array<{
  filename: string;
  duration: number;
}> = [];

if (typeof clipAnalysesRaw === "string") {
  try {
    const parsed = JSON.parse(clipAnalysesRaw);

    if (Array.isArray(parsed)) {
      clipAnalyses = parsed
        .map((item: any) => ({
          filename: String(item?.filename || ""),
          duration: Number(item?.duration || 0),
        }))
        .filter(
          (item) =>
            item.filename &&
            Number.isFinite(item.duration) &&
            item.duration > 0,
        );
    }
  } catch {
    clipAnalyses = [];
  }
}

const durationByFilename = new Map(
  clipAnalyses.map((item) => [item.filename, item.duration]),
);

const sourceAssets = files.map((file) => {
  const duration = durationByFilename.get(file.name);

  if (!duration) {
    throw new Error(
      `Missing real analyzed duration for source: ${file.name}`,
    );
  }

  return {
    filename: file.name,
    duration,
  };
});

const canonicalPlan = normalizeAtlasEditPlan(
  {
    timeline: filteredTimeline,
  },
  sourceAssets,
);

validateExecutableTimeline(
  canonicalPlan,
  sourceAssets,
);

const shots =
  atlasPlanToRemotionShots(canonicalPlan);
    await atlasRunEvent(runId, "VALIDATION", "PASS", { beats: shots.length, files: files.length });
    if (!shots.length) return NextResponse.json({ error: "None of the Edit Director timeline sources match uploaded clips." }, { status: 400 });
    console.log(`[ATLAS PRO EDITOR V2] EXECUTABLE TIMELINE READY | beats=${shots.length}`);
    console.log(`[ATLAS V2 FEATURES] speedRamps=${shots.filter((s:any) => s.speed_curve?.some((p:any) => Math.abs(Number(p.speed) - Number(s.speed_curve?.[0]?.speed || p.speed)) > 0.08)).length} | sfxEvents=${shots.reduce((n:number,s:any) => n + (s.sfx_events?.length || 0), 0)} | musicCurves=${shots.length} | text=${shots.filter((s:any) => String(s.on_screen_text || "").trim()).length} | transitions=${shots.filter((s:any) => s.transition_in !== "CUT" || s.transition_out !== "CUT").length}`);
    shots.forEach((shot, index) => console.log(`[ATLAS V2 SHOT ${index + 1}] ${shot.role} | ${shot.source_filename} | ${shot.start.toFixed(2)}-${shot.end.toFixed(2)} | motion=${shot.motion} | transition=${shot.transition_in}->${shot.transition_out}`));

    const voiceValue = formData.get("voice"); const voiceFile = voiceValue instanceof File && voiceValue.size > 0 ? voiceValue : null;
    const musicValue = formData.get("music"); const musicFile = musicValue instanceof File && musicValue.size > 0 ? musicValue : null;
    let captions: any[] = []; const captionsRaw = formData.get("captions");
    if (typeof captionsRaw === "string") { try { const parsed = JSON.parse(captionsRaw); captions = Array.isArray(parsed) ? parsed : []; } catch { captions = []; } }
    let brand: any = undefined; const businessProfileRaw = formData.get("businessProfile");
    if (typeof businessProfileRaw === "string") {
      try { const profile = JSON.parse(businessProfileRaw); brand = { primaryColor: profile?.brand_colors?.primary || profile?.primaryColor || "#FFFFFF", secondaryColor: profile?.brand_colors?.accent || profile?.secondaryColor || "#C8FF2B", fontFamily: profile?.brand_font || profile?.fontFamily, logo: profile?.logo_url || profile?.logo }; } catch { brand = undefined; }
    }
    const musicVolume = shots.length
      ? shots.reduce(
          (sum, shot) => sum + Number(shot.music_volume ?? 0.12),
          0,
        ) / shots.length
      : 0.12;
    let executableShots = shots;

    if (process.env.ATLAS_AI_SFX_ENABLED !== "false") {
      await atlasRunEvent(runId, "SFX_DIRECTOR", "START", { beats: shots.length });
      const sfxResult = await designAndGenerateSfx(files, shots); executableShots = sfxResult.shots;
      console.log(`[ATLAS SFX DIRECTOR] READY | generatedEvents=${sfxResult.events.length}`);
      await atlasRunEvent(runId, "SFX_DIRECTOR", "COMPLETE", { generatedEvents: sfxResult.events.length });
    }

    executableShots.forEach((shot: any, index: number) => console.log(`[ATLAS SFX-AWARE SHOT ${index + 1}] ${shot.role} | sfxEvents=${Array.isArray(shot.sfx_events) ? shot.sfx_events.length : 0}`));
    await atlasRunEvent(runId, "REMOTION", "EXECUTION_PLAN", { beats: executableShots.length, sfxEvents: executableShots.reduce((n: number, s: any) => n + (Array.isArray(s.sfx_events) ? s.sfx_events.length : 0), 0), speedRamps: executableShots.filter((s: any) => Array.isArray(s.speed_curve) && s.speed_curve.length > 1).length });

    const remotionBuffer = await renderAtlasWithRemotion({ files, shots: executableShots, voiceFile, musicFile, musicVolume: Math.max(0.04, Math.min(0.24, musicVolume)), captions, brand, musicDucking: true, voicePriority: "HIGH", musicDuckingDb: 12 });
    const reviewDir = path.join(os.tmpdir(), "atlas-render-review-cache"); await fs.mkdir(reviewDir, { recursive: true });
    const reviewId = createReviewId(); const reviewPath = path.join(reviewDir, `${reviewId}.mp4`); await fs.writeFile(reviewPath, remotionBuffer);
    const timelineAuditPath = path.join(reviewDir, `${reviewId}.json`);
    await fs.writeFile(timelineAuditPath, JSON.stringify({ version: "ATLAS-AI-SFX-V1", timeline: executableShots, audio_design: { mode: process.env.ATLAS_AI_SFX_ENABLED === "false" ? "disabled" : "ai-generated", generated_sfx_events: executableShots.reduce((sum: number, shot: any) => sum + (Array.isArray(shot.sfx_events) ? shot.sfx_events.length : 0), 0) } }, null, 2), "utf8");
    console.log("ATLAS V2 REVIEW CACHE CREATED:", reviewId, reviewPath); console.log("ATLAS V2 EXECUTION AUDIT CREATED:", timelineAuditPath);

    await atlasRunEvent(runId, "REMOTION", "COMPLETE", { reviewId, bytes: remotionBuffer.length, durationMs: Date.now() - startedAt });
    await writeAtlasRunSummary(runId, { status: "COMPLETE", reviewId, durationMs: Date.now() - startedAt, beats: executableShots.length, files: files.length, sfxEvents: executableShots.reduce((n: number, s: any) => n + (Array.isArray(s.sfx_events) ? s.sfx_events.length : 0), 0), reviewPath, timelineAuditPath });

    // Never block the browser response on diagnostics/GitHub sync.
    // The render is already complete at this point; syncing is observability only.
    void syncAtlasRunToGit(runId)
      .then((syncResult) => console.log(`[ATLAS RUN ${runId}] RUN_SYNC | synced=${syncResult.synced} | reason=${syncResult.reason || ""}`))
      .catch((syncError: any) => console.warn(`[ATLAS RUN ${runId}] RUN_SYNC WARN | ${syncError?.message || String(syncError)}`));

    console.log(`[ATLAS RUN ${runId}] REMOTION HTTP RESPONSE READY | reviewId=${reviewId} | bytes=${remotionBuffer.length}`);
    return new NextResponse(remotionBuffer, { status: 200, headers: { "Content-Type": "video/mp4", "Content-Disposition": 'attachment; filename="atlas-v2-reel.mp4"', "Content-Length": String(remotionBuffer.length), "Cache-Control": "no-store", "X-Atlas-Review-Id": reviewId, "X-Atlas-Render-Engine": "remotion-v2", "X-Atlas-SFX-Mode": process.env.ATLAS_AI_SFX_ENABLED === "false" ? "off" : "ai-generated", "X-Atlas-SFX-Events": String(executableShots.reduce((sum: number, shot: any) => sum + (Array.isArray(shot.sfx_events) ? shot.sfx_events.length : 0), 0)), "Access-Control-Expose-Headers": "X-Atlas-Review-Id, X-Atlas-Render-Engine, X-Atlas-SFX-Mode, X-Atlas-SFX-Events" } });
  } catch (error: any) {
    await atlasRunEvent(runId, "REMOTION", "ERROR", { message: error?.message || String(error), durationMs: Date.now() - startedAt }, "error");
    await writeAtlasRunSummary(runId, { status: "ERROR", durationMs: Date.now() - startedAt, error: error?.message || String(error) });
    void syncAtlasRunToGit(runId)
      .then((syncResult) => console.log(`[ATLAS RUN ${runId}] RUN_SYNC | synced=${syncResult.synced} | reason=${syncResult.reason || ""}`))
      .catch((syncError: any) => console.warn(`[ATLAS RUN ${runId}] RUN_SYNC WARN | ${syncError?.message || String(syncError)}`));
    console.error("ATLAS PRO EDITOR V2 REMOTION ERROR", error);
    return NextResponse.json({ error: error?.message || error?.stderr || "ATLAS V2 Remotion render failed." }, { status: 500 });
  }
}