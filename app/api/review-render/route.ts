import OpenAI from "openai";
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

export const runtime = "nodejs";
const execFileAsync = promisify(execFile);
const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    overall_score: { type: "number" },
    dimension_scores: { type: "object", additionalProperties: false, properties: {
      hook: {type:"number"}, pacing:{type:"number"}, story:{type:"number"}, visual_variety:{type:"number"}, continuity:{type:"number"}, typography:{type:"number"}, audio:{type:"number"}, brand:{type:"number"}, cta:{type:"number"}
    }, required:["hook","pacing","story","visual_variety","continuity","typography","audio","brand","cta"] },
    root_cause: { type:"string" },
    priority_fix: { type:"string" },
    preserve: { type:"array", items:{type:"string"} },
    verdict: { type: "string", enum: ["PASS", "REVISE"] },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    issues: { type: "array", items: { type: "object", additionalProperties: false, properties: {
      severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      category: { type: "string" }, timestamp_seconds: { type: "number" },
      problem: { type: "string" }, fix: { type: "string" },
    }, required: ["severity","category","timestamp_seconds","problem","fix"] } },
    revised_shots: { type: "array", items: {
  type: "object", additionalProperties: false,
  properties: {
    id:{type:"string"}, role:{type:"string"}, source_filename:{type:"string"}, visual_moment_label:{type:"string"},
    purpose:{type:"string"}, visual_action:{type:"string"}, editorial_score:{type:"number"}, selection_reason:{type:"string"},
    speech_segment_ids:{type:"array",items:{type:"string"}}, visual_treatment:{type:"string"}, crop:{type:"string"}, zoom:{type:"number"}, speed:{type:"number"},
    motion:{type:"string"}, transition_in:{type:"string"}, transition_out:{type:"string"}, on_screen_text:{type:"string"}, text_style:{type:"string"},
    text_animation:{type:"string"}, text_position:{type:"string"}, caption_mode:{type:"string"}, caption_emphasis:{type:"array",items:{type:"string"}},
    music_intensity:{type:"number"}, voice_priority:{type:"number"}, sfx:{type:"array",items:{type:"string"}}, sfx_events:{type:"array",items:{type:"object",additionalProperties:false,properties:{type:{type:"string"},at:{type:"number"},volume:{type:"number"}},required:["type","at","volume"]}}, speed_curve:{type:"array",items:{type:"object",additionalProperties:false,properties:{at:{type:"number"},speed:{type:"number"}},required:["at","speed"]}}, music_curve:{type:"array",items:{type:"object",additionalProperties:false,properties:{at:{type:"number"},level:{type:"number"}},required:["at","level"]}}, start:{type:"number"}, end:{type:"number"}
  },
  required:["id","role","source_filename","visual_moment_label","purpose","visual_action","editorial_score","selection_reason","speech_segment_ids","visual_treatment","crop","zoom","speed","motion","transition_in","transition_out","on_screen_text","text_style","text_animation","text_position","caption_mode","caption_emphasis","music_intensity","voice_priority","sfx","sfx_events","speed_curve","music_curve","start","end"]
} },
  },
  required: ["overall_score","dimension_scores","root_cause","priority_fix","preserve","verdict","summary","strengths","issues","revised_shots"],
} as const;

async function findBinary() {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    "C:\\Users\\EPIVATIKOS\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe",
  ];
  for (const p of candidates) {
    try { await fs.access(p); return p; } catch {}
  }
  try {
    const { stdout } = await execFileAsync("where.exe", ["ffmpeg"], { windowsHide: true });
    const p = stdout.split(/\r?\n/).map(x => x.trim()).find(Boolean);
    if (p) return p;
  } catch {}
  throw new Error("ffmpeg executable was not found.");
}

async function reviewRender(content: any[]) {
  if (!openai || !apiKey) throw new Error("OPENAI_API_KEY is missing.");
  const r = await openai.responses.create({
    model: "gpt-5.4-mini", store: false,
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: "atlas_render_review_v2", strict: true, schema } },
  });
  if (!r.output_text) throw new Error("ATLAS Render Reviewer returned no result.");
  return JSON.parse(r.output_text);
}

export async function POST(request: Request) {
  let tempDir = "";
  try {
    const form = await request.formData();
    const reviewId = String(form.get("reviewId") || "").trim();
    const video = form.get("video");
    console.log("================================");
    console.log("ATLAS SERVER-SIDE RENDER REVIEW V10");
    console.log("================================");

    const ffmpeg = await findBinary();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-review-"));
    const videoPath = path.join(tempDir, "render.mp4");
    const framesDir = path.join(tempDir, "frames");
    await fs.mkdir(framesDir);

    if (reviewId) {
      const cachedPath = path.join(os.tmpdir(), "atlas-render-review-cache", `${reviewId}.mp4`);
      try {
        await fs.access(cachedPath);
        await fs.copyFile(cachedPath, videoPath);
        console.log(`ATLAS REVIEW USING SERVER CACHE: ${cachedPath}`);
      } catch {
        return NextResponse.json({ error: `Review cache not found for ${reviewId}.` }, { status: 404 });
      }
    } else if (video instanceof File && video.size > 0) {
      console.log(`Incoming rendered MP4: ${video.name} (${video.size} bytes)`);
      await fs.writeFile(videoPath, Buffer.from(await video.arrayBuffer()));
    } else {
      return NextResponse.json({ error: "No rendered video or reviewId was supplied." }, { status: 400 });
    }

    // Do NOT require ffprobe. The machine is known to have ffmpeg, while ffprobe
    // is not guaranteed to be installed next to ffmpeg-static on Windows.
    // Sample one frame per second and cap the review at 18 frames.
    const pattern = path.join(framesDir, "frame-%03d.jpg");
    await execFileAsync(
      ffmpeg,
      ["-y", "-i", videoPath, "-vf", "fps=2,scale=540:-2:flags=lanczos", "-q:v", "4", "-frames:v", "30", pattern],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }
    );

    const frameFiles = (await fs.readdir(framesDir))
      .filter(x => /^frame-\d+\.jpg$/.test(x))
      .sort();

    if (!frameFiles.length) {
      throw new Error("ATLAS could not extract any review frames from the rendered video.");
    }

    // At 2 fps, each sampled frame represents roughly 0.5 seconds.
    const duration = Math.max(0, (frameFiles.length - 1) / 2);
    console.log(`ATLAS REVIEW EXTRACTED ${frameFiles.length} frames (~${duration.toFixed(2)}s review timeline)`);
    const brief = String(form.get("creativeBrief") || "{}");
    const plan = String(form.get("masterPlan") || "{}");
    const iteration = Number(form.get("iteration") || 1);

    let execution: any = {};
    const cachedTimelinePath = reviewId
      ? path.join(
          os.tmpdir(),
          "atlas-render-review-cache",
          `${reviewId}.json`,
        )
      : "";

    if (cachedTimelinePath) {
      try {
        execution = JSON.parse(
          await fs.readFile(cachedTimelinePath, "utf8"),
        );
      } catch {
        const timeline = String(form.get("editTimeline") || "{}");
        try {
          execution = JSON.parse(timeline);
        } catch {
          execution = {};
        }
      }
    } else {
      const timeline = String(form.get("editTimeline") || "{}");
      try {
        execution = JSON.parse(timeline);
      } catch {
        execution = {};
      }
    }

    const timelineBeats = Array.isArray((execution as any)?.timeline)
      ? (execution as any).timeline
      : Array.isArray(execution)
        ? execution
        : [];
    const executionStats = {
      beats: timelineBeats.length,
      speedRamps: timelineBeats.filter((x:any) => Array.isArray(x.speed_curve) && x.speed_curve.some((p:any) => Math.abs(Number(p.speed) - Number(x.speed_curve?.[0]?.speed || p.speed)) > 0.08)).length,
      sfxEvents: timelineBeats.reduce((n:number,x:any) => n + (Array.isArray(x.sfx_events) ? x.sfx_events.length : 0), 0),
      transitions: timelineBeats.filter((x:any) => x.transition_in && x.transition_in !== "CUT" || x.transition_out && x.transition_out !== "CUT").length,
      textBeats: timelineBeats.filter((x:any) => String(x.text || "").trim()).length,
    };
    console.log(`[ATLAS REVIEW EXECUTION] beats=${executionStats.beats} | speedRamps=${executionStats.speedRamps} | sfxEvents=${executionStats.sfxEvents} | transitions=${executionStats.transitions} | text=${executionStats.textBeats}`);
    const content: any[] = [{ type: "input_text", text: `You are ATLAS FINAL CUT REVIEWER, a ruthless senior commercial editor. This is render iteration ${iteration}. Judge the ACTUAL rendered Reel from the sampled frames, not just the plan.\n\nCREATIVE BRIEF:\n${brief}\n\nMASTER PLAN:\n${plan}\n\nDURATION: ${duration.toFixed(2)} seconds\n\nEXECUTABLE TIMELINE / FEATURE AUDIT:\n${JSON.stringify(executionStats)}\n\nQUALITY BAR:\n1) First 1.5s must stop scrolling. 2) Every shot earns its place. 3) No dead time or repeated visual idea. 4) Visual must match spoken/on-screen message. 5) Crop protects faces/products. 6) Motion is intentional, not preset-like. 7) Typography is custom, readable and safe. 8) Offer/CTA is instantly understood when relevant. 9) Audio feels like a finished commercial. 10) No watermarks or invented claims. 11) Verify that the actual render visibly/audibly reflects the executable timeline: if the plan requests SFX, ramps, transitions or text, penalize missing execution. 12) Do not reward a feature merely because it exists in JSON; judge the rendered result.\n\nPASS ONLY if >=92/100, no HIGH issues, and no obvious pacing, text or visual mismatch. Otherwise REVISE.\n\nIf REVISE, return a COMPLETE revised_shots array using ONLY existing master-plan shots. You may reorder, shorten, remove, retime within their source windows, and change crop/zoom/speed/motion/transitions/text/captions. Do not invent filenames or footage. Make concrete changes.` }];
    for (let i = 0; i < frameFiles.length; i++) {
      const b = await fs.readFile(path.join(framesDir, frameFiles[i]));
      const t = (i / 2);
      content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${b.toString("base64")}` });
      content.push({ type: "input_text", text: `Frame ${i + 1}/${frameFiles.length}: approximately ${t.toFixed(2)}s.` });
    }
    console.log(`ATLAS REVIEW SENDING ${frameFiles.length} frames to OpenAI Vision...`);
    const review = await reviewRender(content);
    console.log(`ATLAS REVIEW AI RETURNED SCORE ${review.overall_score}/100 | root=${review.root_cause || "none"}`);
    const score = Math.max(0, Math.min(100, Number(review.overall_score) || 0));
    review.overall_score = score;
    review.verdict = score >= 92 && review.verdict === "PASS" && !(review.issues || []).some((x: any) => x.severity === "HIGH") ? "PASS" : "REVISE";
    return NextResponse.json({ success: true, iteration, duration_seconds: duration, frame_count: frameFiles.length, execution_stats: executionStats, ...review });
  } catch (error: any) {
    console.error("ATLAS RENDER REVIEW ERROR", error);
    return NextResponse.json({ error: error?.message || "ATLAS render review failed." }, { status: 500 });
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
