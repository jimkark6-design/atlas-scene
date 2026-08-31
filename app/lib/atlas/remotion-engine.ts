import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { validateSfxExecutionPlan } from "./validate-sfx-execution";

type SfxEvent = {
  type?: string;
  at?: number;
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  mix_db?: number;
  source?: string;
  source_path?: string;
};

type RenderShot = {
  id: string;
  role: string;
  source_filename: string;
  start: number;
  end: number;
  speed?: number;
  sfx?: string[];
  sfx_events?: SfxEvent[];
  source_audio_volume?: number;
  music_volume?: number;
  music_intensity?: number;
  music_curve?: Array<{ at?: number; level?: number }>;
  [key: string]: any;
};

type RenderInput = {
  files: File[];
  shots: RenderShot[];
  voiceFile: File | null;
  musicFile: File | null;
  musicVolume?: number;
  musicDucking?: boolean;
  musicDuckingDb?: number;
  voicePriority?: string;
  captions?: Array<{
    text: string;
    start: number;
    end: number;
    emphasis?: boolean;
    style?: string;
    position?: string;
  }>;
  brand?: {
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
    logo?: string;
  };
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const safeNumber = (value: unknown, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function buildSfx(shots: RenderShot[]) {
  const effects: Array<{ source: string; start: number; duration: number; volume: number; fadeIn: number; fadeOut: number }> = [];
  let timelineCursor = 0;
  for (const shot of shots) {
    const sourceDuration = Math.max(0.25, safeNumber(shot.end, 1) - safeNumber(shot.start, 0));
    const speed = clamp(safeNumber(shot.speed, 1), 0.25, 3);
    const renderedDuration = sourceDuration / speed;
    const events = Array.isArray(shot.sfx_events) ? shot.sfx_events : [];
    for (const event of events.slice(0, 16)) {
      const source = String(event?.source || "").trim();
      if (!source) continue;
      const at = clamp(safeNumber(event?.at, 0), 0, Math.max(0, renderedDuration - 0.05));
      effects.push({
        source,
        start: timelineCursor + at,
        duration: Math.max(0.5, safeNumber(event?.duration, 0.8)),
        volume: clamp(safeNumber(event?.volume, 0.14), 0.05, 0.32),
        fadeIn: clamp(safeNumber(event?.fadeIn, 0.025), 0, 0.15),
        fadeOut: clamp(safeNumber(event?.fadeOut, 0.08), 0.02, 0.25),
      });
    }
    timelineCursor += renderedDuration;
  }
  return effects;
}

export async function renderAtlasWithRemotion(input: RenderInput) {
  const id = crypto.randomUUID();
  const publicRoot = path.join(process.cwd(), "public", ".atlas-remotion", id);
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-remotion-output-"));
  const output = path.join(outDir, "atlas-remotion.mp4");
  await fs.mkdir(publicRoot, { recursive: true });

  try {
    const assets: Record<string, string> = {};
    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i];
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
      const safeExt = ["mp4", "mov", "m4v", "webm", "mkv", "avi"].includes(ext) ? ext : "mp4";
      const name = `clip-${i + 1}.${safeExt}`;
      await fs.writeFile(path.join(publicRoot, name), Buffer.from(await file.arrayBuffer()));
      assets[file.name] = `.atlas-remotion/${id}/${name}`;
    }

    let voice = "";
    if (input.voiceFile) {
      voice = `.atlas-remotion/${id}/voice.mp3`;
      await fs.writeFile(path.join(publicRoot, "voice.mp3"), Buffer.from(await input.voiceFile.arrayBuffer()));
    }

    let music = "";
    if (input.musicFile) {
      const ext = (input.musicFile.name.split(".").pop() || "wav").toLowerCase();
      const name = `music.${ext}`;
      music = `.atlas-remotion/${id}/${name}`;
      await fs.writeFile(path.join(publicRoot, name), Buffer.from(await input.musicFile.arrayBuffer()));
    }

    const aiSfxEnabled = String(process.env.ATLAS_AI_SFX_ENABLED || "").toLowerCase() === "true";
    const renderShots: RenderShot[] = input.shots.map((shot) => ({
      ...shot,
      sfx_events: aiSfxEnabled && Array.isArray(shot.sfx_events)
        ? shot.sfx_events.map((event: any) => ({ ...event }))
        : [],
    }));

    if (aiSfxEnabled) {
      validateSfxExecutionPlan(renderShots);
    }

    const generatedSfxRoot = path.join(publicRoot, "generated-sfx");
    await fs.mkdir(generatedSfxRoot, { recursive: true });
    let generatedIndex = 0;
    for (const shot of renderShots) {
      for (const event of shot.sfx_events || []) {
        const sourcePath = String(event?.source_path || "");
        if (!sourcePath) {
          if (aiSfxEnabled) {
            throw new Error(`SFX execution failed: ${shot.id}/${event?.type || "UNKNOWN"} has no generated source.`);
          }
          continue;
        }
        generatedIndex += 1;
        const ext = (path.extname(sourcePath) || ".mp3").toLowerCase();
        const filename = `sfx-${generatedIndex}${ext}`;
        const destination = path.join(generatedSfxRoot, filename);
        await fs.copyFile(sourcePath, destination);
        event.source = `.atlas-remotion/${id}/generated-sfx/${filename}`;
      }
    }

    const sfx = buildSfx(renderShots);
    console.log(`[ATLAS V2 AUDIO] music=${music ? "ON" : "NONE"} voice=${voice ? "ON" : "NONE"} ducking=${input.musicDucking !== false ? "ON" : "OFF"}`);
    console.log(`[ATLAS V2 SFX] mode=${aiSfxEnabled ? "AI_GENERATED" : "OFF"} events=${sfx.length}`, sfx.map((x) => `${x.source}@${x.start.toFixed(2)}`).join(", "));

    const executedSpeedRamps = input.shots.filter((s: any) => {
      if (safeNumber(s.speed, 1) !== 1) return true;
      const curve = Array.isArray(s.speed_curve) ? s.speed_curve : [];
      if (curve.length < 2) return false;
      const speeds = curve.map((p: any) => safeNumber(p?.speed, 1));
      return Math.max(...speeds) - Math.min(...speeds) > 0.08;
    }).length;
    const plannedSfxEvents = input.shots.reduce((sum: number, s: any) => sum + (Array.isArray(s.sfx_events) ? s.sfx_events.length : 0), 0);
    console.log(`[ATLAS V2 EXECUTION] beats=${input.shots.length} | transitions=${input.shots.filter((s) => String(s.transition_in || "CUT").toUpperCase() !== "CUT" || String(s.transition_out || "CUT").toUpperCase() !== "CUT").length} | speedRamps=${executedSpeedRamps} | plannedSfx=${plannedSfxEvents} | executedSfx=${sfx.length} | text=${input.shots.filter((s) => String(s.on_screen_text || "").trim()).length}`);
    console.log("ATLAS REMOTION: bundling edit engine...");

    const serveUrl = await bundle({ entryPoint: path.resolve(process.cwd(), "remotion", "index.ts") });
    const inputProps = {
      shots: renderShots,
      assets,
      voice,
      music,
      musicVolume: clamp(safeNumber(input.musicVolume, 0.12), 0, 1),
      musicDucking: input.musicDucking !== false,
      musicDuckingDb: clamp(safeNumber(input.musicDuckingDb, 10), 0, 24),
      voicePriority: input.voicePriority || "HIGH",
      captions: input.captions || [],
      brand: input.brand,
      sfx,
      fps: 30,
      width: 1080,
      height: 1920,
    };

    const composition = await selectComposition({ serveUrl, id: "ATLAS-PRO-EDIT", inputProps });
    console.log(`ATLAS REMOTION: rendering ${composition.durationInFrames} frames (${(composition.durationInFrames / composition.fps).toFixed(2)}s)...`);
    await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: output, inputProps, crf: 18, x264Preset: "medium", concurrency: 2, audioCodec: "aac", audioBitrate: "192k", pixelFormat: "yuv420p" });
    const buffer = await fs.readFile(output);
    console.log(`ATLAS REMOTION: render complete | bytes=${buffer.length}`);
    return buffer;
  } finally {
    await fs.rm(publicRoot, { recursive: true, force: true }).catch(() => {});
    await fs.rm(outDir, { recursive: true, force: true }).catch(() => {});
  }
}
