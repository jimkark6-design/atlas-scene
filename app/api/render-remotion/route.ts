import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { renderAtlasWithRemotion } from "@/app/lib/atlas/remotion-engine";
import { designAndGenerateSfx } from "@/app/lib/atlas/sfx-director";
import { deriveSfxEvents, normalizeMusicCurve, normalizeSpeedCurve, validateExecutableTimeline } from "@/app/lib/atlas/atlas-edit-contract";
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
function cleanRole(value: unknown) { const role = String(value || "STORY").toUpperCase(); return ["HOOK", "STORY", "PAYOFF", "CTA"].includes(role) ? role : "STORY"; }
function cleanTransition(value: unknown) { const valueUpper = String(value || "CUT").toUpperCase(); return ["CUT", "DISSOLVE", "FADE", "WHIP", "MATCH", "ZOOM", "PUNCH", "SLIDE_LEFT", "SLIDE_RIGHT", "SLIDE_UP", "SLIDE_DOWN", "FLASH", "NONE"].includes(valueUpper) ? valueUpper : "CUT"; }
function cleanCrop(value: unknown) { const valueUpper = String(value || "CENTER").toUpperCase(); return ["NONE", "CENTER", "FACE", "PRODUCT", "ACTION", "TOP", "BOTTOM", "LEFT", "RIGHT"].includes(valueUpper) ? valueUpper : "CENTER"; }
function cleanSpeed(value: unknown) { const n = Number(value); if (!Number.isFinite(n)) return 1; return Math.max(0.25, Math.min(3, n)); }
function cleanZoom(value: unknown) { const n = Number(value); if (!Number.isFinite(n)) return 1.04; return Math.max(1, Math.min(1.45, n)); }
function finiteNumber(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) ? n : null; }

function normalizeBeat(beat: TimelineBeat, index: number) {
  const rawStart = finiteNumber(beat.source_start) ?? finiteNumber((beat as any).start);
  const rawEnd = finiteNumber(beat.source_end) ?? finiteNumber((beat as any).end);
  const start = Math.max(0, rawStart ?? 0); const end = Math.max(start + 0.25, rawEnd ?? start + 1);
  const zoomStart = cleanZoom(beat.zoom_start); const zoomEnd = cleanZoom(beat.zoom_end); const zoom = zoomStart;
  return {
    id: String(beat.id || `beat-${index + 1}`), role: cleanRole(beat.role), source_filename: String(beat.source_filename || ""),
    source_start: start, source_end: end, start, end, purpose: String(beat.purpose || beat.cut_reason || ""),
    visual_action: String(beat.motion || ""), visual_treatment: String(beat.color_treatment || ""), crop: cleanCrop(beat.crop_focus),
    zoom, zoom_start: zoomStart, zoom_end: zoomEnd, transition_in: cleanTransition(beat.transition_in), transition_out: cleanTransition(beat.transition_out),
    on_screen_text: String(beat.text || ""), caption_mode: "NONE", caption_emphasis: Array.isArray(beat.emphasis_words) ? beat.emphasis_words.map(String) : [],
    music_intensity: Number(beat.music_volume) || 0, voice_priority: 1, speed: cleanSpeed(beat.speed),
    speed_curve: normalizeSpeedCurve(beat.speed_curve, cleanSpeed(beat.speed)), motion: String(beat.motion || ""),
    text_style: String(beat.text_style || ""), text_animation: String(beat.text_animation || "FADE"), text_position: String(beat.text_position || ""),
    sfx: Array.isArray(beat.sfx) ? beat.sfx.map(String) : [], sfx_events: deriveSfxEvents(beat.sfx, beat.sfx_events, Math.max(0, end - start)),
    music_curve: normalizeMusicCurve(beat.music_curve, Number(beat.music_volume) || 0.65), beat_intent: String(beat.beat_intent || ""),
    cut_on: String(beat.cut_on || ""), editorial_score: Number(beat.editorial_score) || 0,
  };
}

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
    const rawTimeline: TimelineBeat[] = Array.isArray(parsedTimeline) ? parsedTimeline : Array.isArray(parsedTimeline?.timeline) ? parsedTimeline.timeline : [];
    if (rawTimeline.length < 1) return NextResponse.json({ error: "Executable editTimeline contains no beats." }, { status: 400 });
    const uploadedNames = new Set(files.map((file) => file.name));
    const shots = rawTimeline.map(normalizeBeat).filter((shot) => uploadedNames.has(shot.source_filename));
    validateExecutableTimeline(shots, files.map((f) => ({ filename: f.name })));
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
    const musicVolume = shots.length ? shots.reduce((sum, shot) => sum + Number(shot.music_intensity || 0.12), 0) / shots.length : 0.12;
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
    const syncResult = await syncAtlasRunToGit(runId);
    console.log(`[ATLAS RUN ${runId}] RUN_SYNC | synced=${syncResult.synced} | reason=${syncResult.reason || ""}`);

    return new NextResponse(remotionBuffer, { status: 200, headers: { "Content-Type": "video/mp4", "Content-Disposition": 'attachment; filename="atlas-v2-reel.mp4"', "Content-Length": String(remotionBuffer.length), "Cache-Control": "no-store", "X-Atlas-Review-Id": reviewId, "X-Atlas-Render-Engine": "remotion-v2", "X-Atlas-SFX-Mode": process.env.ATLAS_AI_SFX_ENABLED === "false" ? "off" : "ai-generated", "X-Atlas-SFX-Events": String(executableShots.reduce((sum: number, shot: any) => sum + (Array.isArray(shot.sfx_events) ? shot.sfx_events.length : 0), 0)), "Access-Control-Expose-Headers": "X-Atlas-Review-Id, X-Atlas-Render-Engine, X-Atlas-SFX-Mode, X-Atlas-SFX-Events" } });
  } catch (error: any) {
    await atlasRunEvent(runId, "REMOTION", "ERROR", { message: error?.message || String(error), durationMs: Date.now() - startedAt }, "error");
    await writeAtlasRunSummary(runId, { status: "ERROR", durationMs: Date.now() - startedAt, error: error?.message || String(error) });
    const syncResult = await syncAtlasRunToGit(runId);
    console.log(`[ATLAS RUN ${runId}] RUN_SYNC | synced=${syncResult.synced} | reason=${syncResult.reason || ""}`);
    console.error("ATLAS PRO EDITOR V2 REMOTION ERROR", error);
    return NextResponse.json({ error: error?.message || error?.stderr || "ATLAS V2 Remotion render failed." }, { status: 500 });
  }
}
