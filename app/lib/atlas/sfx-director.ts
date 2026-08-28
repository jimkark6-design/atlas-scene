import OpenAI from "openai";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

type SfxEvent = {
  id: string;
  shot_id: string;
  at: number;
  duration: number;
  prompt: string;
  volume: number;
  fade_in: number;
  fade_out: number;
  mix_db: number;
  reason: string;
  source_path?: string;
};

type SfxPlan = { events: SfxEvent[] };

const schema = { type: "object", additionalProperties: false, properties: { events: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, shot_id: { type: "string" }, at: { type: "number" }, duration: { type: "number" }, prompt: { type: "string" }, volume: { type: "number" }, fade_in: { type: "number" }, fade_out: { type: "number" }, mix_db: { type: "number" }, reason: { type: "string" } }, required: ["id", "shot_id", "at", "duration", "prompt", "volume", "fade_in", "fade_out", "mix_db", "reason"] } } }, required: ["events"] } as const;

const openaiKey = process.env.OPENAI_API_KEY;
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;
const elevenKey = process.env.ELEVENLABS_API_KEY;

async function findFfmpeg(): Promise<string> {
  const cwd = process.cwd();
  const candidates = [path.join(cwd, "node_modules", "ffmpeg-static", "ffmpeg.exe"), path.join(cwd, "atlas-scene", "node_modules", "ffmpeg-static", "ffmpeg.exe"), "C:\\Users\\EPIVATIKOS\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe"];
  for (const candidate of candidates) { try { await fs.access(candidate); return candidate; } catch {} }
  try { const { stdout } = await execFileAsync("where.exe", ["ffmpeg"], { windowsHide: true, maxBuffer: 1024 * 1024 }); const found = stdout.split(/\r?\n/).map((x) => x.trim()).find(Boolean); if (found) return found; } catch {}
  throw new Error("ATLAS SFX DIRECTOR: FFmpeg executable was not found.");
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function safeDuration(n: unknown) { return clamp(Number(n) || 0.65, 0.25, 1.8); }

function cleanEvent(event: any, shots: any[]): SfxEvent | null {
  const shot = shots.find((x) => String(x.id) === String(event?.shot_id));
  if (!shot) return null;
  const shotDuration = Math.max(0.25, Number(shot.end || 0) - Number(shot.start || 0));
  const at = clamp(Number(event?.at) || 0, 0, Math.max(0, shotDuration - 0.05));
  const duration = Math.min(safeDuration(event?.duration), Math.max(0.25, shotDuration - at + 0.15));
  const prompt = String(event?.prompt || "").trim();
  if (!prompt) return null;
  return {
    id: String(event.id || crypto.randomUUID()), shot_id: String(shot.id), at: Number(at.toFixed(3)), duration: Number(duration.toFixed(3)), prompt: prompt.slice(0, 440),
    volume: clamp(Number(event?.volume) || 0.14, 0.06, 0.26), fade_in: clamp(Number(event?.fade_in) || 0.025, 0, 0.12), fade_out: clamp(Number(event?.fade_out) || 0.08, 0.02, 0.22), mix_db: clamp(Number(event?.mix_db) || -18, -30, -10), reason: String(event?.reason || "Motivated by visible action").slice(0, 300),
  };
}

async function extractFrames(files: File[], shots: any[]): Promise<{ content: any[]; tempDir: string }> {
  const ffmpeg = await findFfmpeg();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-sfx-director-"));
  const clipsDir = path.join(tempDir, "clips"); const framesDir = path.join(tempDir, "frames");
  await fs.mkdir(clipsDir); await fs.mkdir(framesDir);
  const written = new Map<string, string>();
  for (const file of files) {
    const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
    const safe = ["mp4", "mov", "m4v", "webm", "mkv", "avi"].includes(ext) ? ext : "mp4";
    const filePath = path.join(clipsDir, `${crypto.createHash("sha1").update(file.name).digest("hex").slice(0, 12)}.${safe}`);
    await fs.writeFile(filePath, Buffer.from(await file.arrayBuffer())); written.set(file.name, filePath);
  }
  const content: any[] = [];
  for (const shot of shots.slice(0, 12)) {
    const clipPath = written.get(String(shot.source_filename));
    if (!clipPath) { console.warn(`[ATLAS SFX DIRECTOR] missing source | shot=${shot.id} | file=${shot.source_filename}`); continue; }
    const start = Math.max(0, Number(shot.start) || 0); const end = Math.max(start + 0.25, Number(shot.end) || start + 1); const mid = start + (end - start) * 0.5; const duration = Math.max(0.25, end - start);
    const sampleTimes = [["start", start + Math.min(0.12, duration * 0.12)], ["mid", mid]] as const;
    for (const [label, time] of sampleTimes) {
      const framePath = path.join(framesDir, `${String(shot.id).replace(/[^a-z0-9_-]/gi, "_")}-${label}.jpg`);
      try {
        await execFileAsync(ffmpeg, ["-y", "-ss", time.toFixed(3), "-i", clipPath, "-frames:v", "1", "-vf", "scale=480:-2:flags=lanczos", "-q:v", "5", framePath], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        const bytes = await fs.readFile(framePath);
        content.push({ type: "input_image", image_url: `data:image/jpeg;base64,${bytes.toString("base64")}` });
        content.push({ type: "input_text", text: `VISUAL SAMPLE | shot=${shot.id} | ${label} | source_time=${time.toFixed(2)}s` });
      } catch (error) { console.warn("[ATLAS SFX DIRECTOR] frame extraction failed", shot.id, label, error); }
    }
  }
  return { content, tempDir };
}

async function askSfxDirector(content: any[], shots: any[]): Promise<SfxEvent[]> {
  if (!openai) throw new Error("ATLAS SFX DIRECTOR: OPENAI_API_KEY is missing.");
  const timelineSummary = shots.map((shot: any, index: number) => ({ index: index + 1, id: String(shot.id), role: String(shot.role || "STORY"), source_filename: String(shot.source_filename), source_start: Number(shot.start), source_end: Number(shot.end), duration: Math.max(0.25, Number(shot.end) - Number(shot.start)), purpose: String(shot.purpose || ""), visual_action: String(shot.visual_action || shot.motion || ""), motion: String(shot.motion || ""), transition_in: String(shot.transition_in || "CUT"), transition_out: String(shot.transition_out || "CUT"), music_intensity: Number(shot.music_intensity || shot.music_volume || 0), text: String(shot.on_screen_text || "") }));
  const prompt = `You are the ATLAS SFX DIRECTOR.\n\nYou are the professional sound designer for the ENTIRE executable Reel.\n\nYou are NOT a soundboard.\nYou do NOT fill silence with random effects.\n\nAnalyze the complete timeline together with the supplied visual samples.\n\nPRIMARY GOAL:\nMake the Reel feel like a professionally sound-designed premium commercial.\n\nThe sound must feel intentional, physical, subtle and synchronized to what the viewer actually sees.\n\nHARD RULES:\n1. Silence is valid and often better than an unnecessary SFX.\n2. Every SFX MUST have a concrete visual or editorial reason.\n3. Never invent an action that is not visible or strongly implied.\n4. Prefer authentic physical Foley: water, spray, foam, cloth, brush, vacuum, machine, polishing, metal, plastic, click, etc.\n5. Use cinematic whooshes or impacts only when movement, reveal, typography or transition actually motivates them.\n6. Never use generic notification sounds.\n7. Never use random filler pops.\n8. Do not place an SFX on every shot.\n9. Maximum 8 total SFX.\n10. Maximum 1 primary physical SFX per shot.\n11. A second SFX on a shot is allowed only when it is a separate major reveal or transition moment.\n12. Never place two SFX within 0.35 seconds.\n13. Voice has highest priority.\n14. SFX must stay clearly below voice.\n15. SFX must normally be between 0.08 and 0.22 volume.\n16. Strong impacts may reach 0.26 only when there is no competing voice.\n17. SFX should normally be short, clean, realistic and premium.\n18. Do not create long ambience.\n19. Generate one individual sound for one individual event.\n20. Do not ask the sound generator for music, dialogue or multiple events.\n21. The generation prompt must describe ONLY the desired sound.\n22. For a premium car-detailing commercial, favor authentic detailing Foley.\n23. If a beat is visually weak for sound, use no SFX.\n24. CTA may have one restrained premium accent.\n25. Do not use an SFX merely because there is a cut.\n\nTIMING:\n"at" is LOCAL time inside the shot. Place physical sounds exactly where the visible action happens. Place whooshes slightly before or directly on directional movement when appropriate. Do not put sounds at arbitrary beat centers.\n\nMIX:\nvolume = linear playback level. Typical: 0.08 - 0.18. Strong: 0.18 - 0.22. Exceptional: 0.23 - 0.26. mix_db: normally -24 to -12. fade_in: very small. fade_out: natural and short.\n\nGENERATION PROMPT:\nWrite a highly specific ElevenLabs sound-generation prompt. Maximum 440 characters. Include when useful: physical source, action, material, environment, microphone perspective, transient, texture, premium realism. Do NOT include music, voiceover, dialogue, editing instructions, multiple unrelated sounds.\n\nIMPORTANT:\nThe final Reel must not sound like a template. If two shots have similar actions, do NOT automatically create two identical SFX. Choose the strongest moment.\n\nEXECUTABLE TIMELINE:\n${JSON.stringify(timelineSummary)}\n\nReturn JSON only.`;
  const result = await openai.responses.create({ model: "gpt-5.4-mini", store: false, input: [{ role: "user", content: [{ type: "input_text", text: prompt }, ...content] }], text: { format: { type: "json_schema", name: "atlas_sfx_director_v1", strict: true, schema } } });
  if (!result.output_text) throw new Error("ATLAS SFX DIRECTOR returned no result.");
  const parsed = JSON.parse(result.output_text) as SfxPlan;
  const cleaned = (Array.isArray(parsed.events) ? parsed.events : []).map((event) => cleanEvent(event, shots)).filter(Boolean) as SfxEvent[];
  cleaned.sort((a, b) => { const ai = shots.findIndex((s: any) => String(s.id) === a.shot_id); const bi = shots.findIndex((s: any) => String(s.id) === b.shot_id); return ai - bi || a.at - b.at; });
  const limited: SfxEvent[] = [];
  for (const event of cleaned) {
    const previous = limited[limited.length - 1];
    const sameShotCount = limited.filter((x) => x.shot_id === event.shot_id).length;
    if (sameShotCount >= 1) continue;
    if (previous && Math.abs(event.at - previous.at) < 0.35) continue;
    limited.push(event); if (limited.length >= 8) break;
  }
  return limited;
}

async function generateOne(event: SfxEvent, outputDir: string): Promise<SfxEvent> {
  if (!elevenKey) throw new Error("ATLAS SFX DIRECTOR: ELEVENLABS_API_KEY is missing. Add it to .env.local.");
  const hash = crypto.createHash("sha1").update(`${event.prompt}|${event.duration.toFixed(2)}`).digest("hex").slice(0, 16);
  const outputPath = path.join(outputDir, `${hash}.mp3`);
  try { await fs.access(outputPath); console.log(`[ATLAS AI SFX] CACHE HIT | ${event.id}`); return { ...event, source_path: outputPath }; } catch {}
  console.log(`[ATLAS AI SFX] GENERATING | ${event.id} | duration=${event.duration.toFixed(2)} | volume=${event.volume.toFixed(2)}`);
  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", { method: "POST", headers: { "xi-api-key": elevenKey, "Content-Type": "application/json" }, body: JSON.stringify({ text: event.prompt, duration_seconds: event.duration, prompt_influence: 0.78, model_id: "eleven_text_to_sound_v2", loop: false }) });
  if (!response.ok) { const body = await response.text(); throw new Error(`ATLAS SFX GENERATION FAILED (${response.status}): ${body.slice(0, 500)}`); }
  const audio = Buffer.from(await response.arrayBuffer()); await fs.writeFile(outputPath, audio); console.log(`[ATLAS AI SFX] GENERATED | ${event.id} | bytes=${audio.length}`); return { ...event, source_path: outputPath };
}

export async function designAndGenerateSfx(files: File[], shots: any[]): Promise<{ shots: any[]; events: SfxEvent[] }> {
  const enabled = String(process.env.ATLAS_AI_SFX_ENABLED || "").toLowerCase() === "true";
  console.log(`[ATLAS SFX DIRECTOR] STATUS | enabled=${enabled}`);
  if (!enabled) {
    console.log("[ATLAS SFX DIRECTOR] disabled by ATLAS_AI_SFX_ENABLED=false");
    // The incoming edit plan may contain advisory SFX suggestions. When the
    // AI SFX subsystem is disabled, those suggestions are not executable audio
    // events and must not cross the render boundary.
    const disabledShots = shots.map((shot: any) => ({ ...shot, sfx_events: [] }));
    return { shots: disabledShots, events: [] };
  }
  if (!openai) throw new Error("ATLAS SFX DIRECTOR: OPENAI_API_KEY is missing.");
  if (!elevenKey) throw new Error("ATLAS SFX DIRECTOR: ELEVENLABS_API_KEY is missing. Add it to .env.local.");
  console.log(`[ATLAS SFX DIRECTOR] START | beats=${shots.length} | files=${files.length}`);
  const { content, tempDir } = await extractFrames(files, shots);
  const generatedDir = path.join(tempDir, "generated"); await fs.mkdir(generatedDir);
  try {
    console.log(`[ATLAS SFX DIRECTOR] ANALYZING TIMELINE | beats=${shots.length} | visualSamples=${content.filter((x) => x.type === "input_image").length}`);
    const events = await askSfxDirector(content, shots);
    console.log(`[ATLAS SFX DIRECTOR] PLAN | events=${events.length}`);
    for (const event of events) { console.log(`[ATLAS AI SFX PLAN] ${event.id} | shot=${event.shot_id} | at=${event.at.toFixed(2)} | duration=${event.duration.toFixed(2)} | vol=${event.volume.toFixed(2)} | reason=${event.reason}`); console.log(`[ATLAS AI SFX PROMPT] ${event.id} | ${event.prompt}`); }
    const generated: SfxEvent[] = []; let generationFailed = 0;
    for (const event of events) { try { generated.push(await generateOne(event, generatedDir)); } catch (error) { generationFailed++; console.warn(`[ATLAS AI SFX] FAILED | ${event.id}`, error); } }
    console.log(`[ATLAS SFX DIRECTOR] COMPLETE | planned=${events.length} | generated=${generated.length} | failed=${generationFailed}`);
    const byShot = new Map<string, SfxEvent[]>();
    for (const event of generated) { const list = byShot.get(event.shot_id) || []; list.push(event); byShot.set(event.shot_id, list); }
    const nextShots = shots.map((shot: any) => { const shotEvents = byShot.get(String(shot.id)) || []; return { ...shot, sfx_events: shotEvents.map((event) => ({ type: "AI_GENERATED", at: event.at, duration: event.duration, volume: event.volume, fadeIn: event.fade_in, fadeOut: event.fade_out, mix_db: event.mix_db, reason: event.reason, prompt: event.prompt, source_path: event.source_path })) }; });
    return { shots: nextShots, events: generated };
  } finally { await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {}); }
}
