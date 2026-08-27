import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";
import { renderAtlasWithRemotion } from "@/app/lib/atlas/remotion-engine";

const execFileAsync = promisify(execFile);
export const runtime = "nodejs";

type Role = "HOOK" | "STORY" | "PAYOFF" | "CTA";

type Shot = {
  id: string;
  role: Role;
  source_filename: string;
  start: number;
  end: number;
  purpose?: string;
  visual_action?: string;
  visual_treatment?: string;
  crop?: "NONE" | "CENTER" | "FACE" | "PRODUCT" | "ACTION";
  zoom?: number;
  transition_in?: "CUT" | "DISSOLVE" | "WHIP" | "MATCH" | "NONE";
  transition_out?: "CUT" | "DISSOLVE" | "WHIP" | "MATCH" | "NONE";
  on_screen_text?: string;
  speech_segment_ids?: string[];
  caption_mode?: "NONE" | "WORD_BY_WORD" | "PHRASE";
  caption_emphasis?: string[];
  music_intensity?: number;
  voice_priority?: number;
  text_style?: string;
  text_animation?: string;
  text_position?: string;
  sfx?: string[];
  speed?: number;
};

type MasterPlan = {
  shots: Shot[];
  global_audio?: any;
  global_captions?: any;
};

type Caption = {
  id?: string;
  filename: string;
  start: number;
  end: number;
  text: string;
  words?: { word: string; start: number; end: number }[];
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeSfxName(raw: string) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9_ -]/g, "")
    .replace(/\s+/g, "_")
    .trim();
}

/**
 * ATLAS can add sound design even when the model returns no explicit SFX list.
 * The renderer derives a small, purpose-driven cue set from the visual action
 * and the editorial role. This is intentionally conservative: max two cues per
 * beat so the sound bed never becomes a wall of effects.
 */
function deriveAutoSfx(shot: Shot, index: number) {
  const haystack = [
    shot.visual_action,
    shot.purpose,
    shot.visual_treatment,
    shot.on_screen_text,
    shot.role,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const cues: string[] = [];
  const add = (name: string) => {
    const normalized = normalizeSfxName(name);
    if (normalized && !cues.includes(normalized) && cues.length < 2) cues.push(normalized);
  };

  if (/foam|suds/.test(haystack)) {
    add("FOAM");
  }
  if (/water|spray|wash|rinse|steam|pour|splash|liquid|cleaning/.test(haystack)) {
    add("WATER_SPRAY");
  }
  if (/wipe|wipe.?down|cloth|microfiber|rub|brush|polish|buff|detail/.test(haystack)) {
    add("WIPE_TEXTURE");
  }
  if (/machine|vacuum|drill|rotary|polisher|motor/.test(haystack)) {
    add("MACHINE_HUM");
  }
  if (/reveal|hero|finished|shine|gloss|premium|final|showcase/.test(haystack)) {
    add("REVEAL_IMPACT");
  }
  if (/price|offer|book|today|cta|call|visit|order|buy|now/.test(haystack)) {
    add("CTA_HIT");
  }
  if (/cut|transition|whip|slide|move|pan|push|pull|zoom/.test(haystack)) {
    add("WHOOSH");
  }

  // Every edit beat gets at least one subtle editorial cue when there is no
  // more specific physical sound to use. This keeps otherwise silent cuts alive.
  if (!cues.length && (shot.role === "HOOK" || shot.role === "PAYOFF" || shot.role === "CTA")) {
    add(index === 0 ? "HOOK_IMPACT" : shot.role === "CTA" ? "CTA_HIT" : "SOFT_IMPACT");
  }

  return cues;
}

async function findFfmpeg(): Promise<string> {
  const cwd = process.cwd();

  const candidates = [
    path.join(
      cwd,
      "node_modules",
      "ffmpeg-static",
      "ffmpeg.exe"
    ),
    path.join(
      cwd,
      "atlas-scene",
      "node_modules",
      "ffmpeg-static",
      "ffmpeg.exe"
    ),

    // FFmpeg installed through winget and already verified on this PC.
    "C:\\Users\\EPIVATIKOS\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffmpeg.exe",
  ];

  console.log("ATLAS RENDER process.cwd():", cwd);
  console.log("ATLAS RENDER FFmpeg candidates:");

  for (const candidate of candidates) {
    console.log(candidate);

    try {
      await fs.access(candidate);
      console.log("ATLAS RENDER FOUND FFMPEG:", candidate);
      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  // Final fallback: Windows PATH.
  try {
    const result = await execFileAsync(
      "where.exe",
      ["ffmpeg"],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      }
    );

    const found = result.stdout
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .find(Boolean);

    if (found) {
      console.log("ATLAS RENDER FOUND FFMPEG FROM PATH:", found);
      return found;
    }
  } catch {
    // Fall through to the useful error below.
  }

  throw new Error(
    "FFmpeg executable was not found. Checked: " +
      candidates.join(" | ")
  );
}

function ffPath(p: string) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:");
}

function textFileFilter(
  font: string,
  file: string,
  size: number,
  y: string,
  start: number,
  end: number,
  border = 5
) {
  return `drawtext=fontfile='${ffPath(font)}':textfile='${ffPath(file)}':reload=0:fontcolor=white:fontsize=${size}:borderw=${border}:bordercolor=black@0.78:x=(w-text_w)/2:y=${y}:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'`;
}

function animatedTextFilter(
  font: string,
  file: string,
  size: number,
  start: number,
  end: number,
  style = "CLEAN",
  animation = "FADE_UP",
  position = "LOWER"
) {
  const a = String(animation || "FADE_UP").toUpperCase();
  const st = String(style || "CLEAN").toUpperCase();
  const pos = String(position || "LOWER").toUpperCase();

  const isPrice = st.includes("PRICE") || st.includes("ACCENT");
  const isHook = st.includes("HOOK") || st.includes("KINETIC");
  const isCta = st.includes("CTA");
  const isBadge = st.includes("BADGE");
  const isMinimal = st.includes("MINIMAL") || st.includes("CLEAN");
  const isOutline = st.includes("OUTLINE");
  const isSmall = st.includes("SMALL") || st.includes("LABEL");

  const centerY = pos === "TOP" || pos === "SAFE_TOP"
    ? "h*0.13"
    : pos === "CENTER"
      ? "(h-text_h)/2"
      : "h*0.76";

  const safeX = "(w-text_w)/2";
  const local = `(t-${start.toFixed(3)})`;
  const progress = `min(1\\,max(0\\,${local}/0.18))`;
  let x = safeX;
  let y = centerY;
  let alpha = "1";
  let scaleOffset = "0";

  if (a.includes("SLIDE_UP") || a.includes("FADE_UP")) y = `(${centerY})+72*(1-${progress})`;
  else if (a.includes("SLIDE_LEFT")) x = `(${safeX})-130*(1-${progress})`;
  else if (a.includes("SLIDE_RIGHT")) x = `(${safeX})+130*(1-${progress})`;
  else if (a.includes("POP") || a.includes("WORD_POP")) {
    alpha = `0.82+0.18*${progress}`;
    scaleOffset = isPrice ? `10*(1-${progress})` : `6*(1-${progress})`;
    y = `(${centerY})+${scaleOffset}`;
  } else if (a.includes("FADE")) alpha = progress;

  const color = isPrice ? "0xB6FF00" : "white";
  const weight = isPrice ? Math.max(96, size + 10) : isHook ? Math.max(82, size) : isSmall ? Math.max(44, size - 22) : isMinimal ? Math.max(50, size - 8) : size;
  const border = isOutline ? 7 : isHook || isPrice ? 3 : 4;
  const box = isPrice || isCta || isBadge ? 1 : 0;
  const boxColor = isPrice ? "black@0.78" : isCta ? "black@0.68" : "black@0.52";
  const boxBorder = isPrice ? 24 : isCta ? 20 : isBadge ? 16 : 0;
  const shadow = isMinimal ? "shadowx=0:shadowy=2:shadowcolor=black@0.65" : "shadowx=0:shadowy=4:shadowcolor=black@0.78";

  return [
    `drawtext=fontfile='${ffPath(font)}':textfile='${ffPath(file)}':reload=0`,
    `fontcolor=${color}`,
    `fontsize=${weight}`,
    `borderw=${border}`,
    `bordercolor=black@0.78`,
    `box=${box}`,
    `boxcolor=${boxColor}`,
    `boxborderw=${boxBorder}`,
    `x='${x}'`,
    `y='${y}'`,
    `alpha='${alpha}'`,
    shadow,
    `enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'`,
  ].join(":");
}


async function buildKineticTextFilters(
  font: string,
  tempDir: string,
  text: string,
  start: number,
  end: number,
  size: number,
  style: string,
  animation: string,
  position: string,
  shotRole: Role
) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const words = clean.split(" ").filter(Boolean).slice(0, 6);
  const anim = String(animation || "").toUpperCase();
  const wantsKinetic =
    anim.includes("WORD") ||
    anim.includes("POP") ||
    String(style || "").toUpperCase().includes("KINETIC");

  if (!wantsKinetic || words.length < 2 || words.length > 6) {
    const p = path.join(tempDir, `kinetic-single-${crypto.randomUUID()}.txt`);
    await fs.writeFile(p, clean, "utf8");
    return [
      animatedTextFilter(
        font,
        p,
        size,
        start,
        end,
        style,
        animation,
        position
      ),
    ];
  }

  const filters: string[] = [];
  const total = Math.max(0.35, end - start);
  const stagger = Math.min(0.085, Math.max(0.045, total / Math.max(8, words.length * 5)));
  const wordHold = Math.max(0.20, total - stagger * (words.length - 1));

  for (let i = 0; i < words.length; i++) {
    const wordPath = path.join(tempDir, `kinetic-word-${crypto.randomUUID()}.txt`);
    await fs.writeFile(wordPath, words[i], "utf8");
    const wordStart = start + i * stagger;
    const wordEnd = Math.min(end, wordStart + wordHold);
    const wordStyle = i === 0 && (shotRole === "HOOK" || String(style).toUpperCase().includes("EMPHASIS"))
      ? `${style} ACCENT`
      : style;
    filters.push(
      animatedTextFilter(
        font,
        wordPath,
        i === 0 ? size + 6 : size,
        wordStart,
        Math.max(wordStart + 0.12, wordEnd),
        wordStyle,
        "POP",
        position
      )
    );
  }

  return filters;
}

function motionFilter(shot: Shot, index: number, duration: number) {
  const zoom = clamp(Number(shot.zoom) || 1, 1, 1.22);
  const treatment = String(shot.visual_treatment || "").toLowerCase();
  const action = String(shot.visual_action || "").toLowerCase();
  const requested = `${String((shot as any).motion || "")} ${treatment} ${action}`.toLowerCase();
  const plannedSpeed = Number(shot.speed);

  // Render a little oversized, then animate the crop window. This is reliable
  // on FFmpeg builds and creates real camera movement from static phone footage.
  const scale = Math.max(1.06, zoom + (shot.role === "HOOK" ? 0.14 : shot.role === "CTA" ? 0.065 : 0.045));
  const w = Math.round(1080 * scale);
  const h = Math.round(1920 * scale);
  const t = `min(1\\,max(0\\,t/${Math.max(0.25, duration).toFixed(3)}))`;
  const travel = shot.role === "HOOK" ? 0.24 : shot.role === "CTA" ? 0.12 : 0.095;
  const direction = index % 2 === 0 ? 1 : -1;

  let x = `(iw-1080)/2`;
  let y = `(ih-1920)/2`;

  if (requested.includes("pan-left")) x = `(iw-1080)*(0.66-${travel}*${t})`;
  else if (requested.includes("pan-right")) x = `(iw-1080)*(0.34+${travel}*${t})`;
  else if (requested.includes("tilt-up")) y = `(ih-1920)*(0.64-${travel * 0.75}*${t})`;
  else if (requested.includes("tilt-down")) y = `(ih-1920)*(0.36+${travel * 0.75}*${t})`;
  else if (requested.includes("pull-out")) {
    x = `(iw-1080)*(0.5+${0.06 * direction}*${t})`;
    y = `(ih-1920)*(0.5+0.02*sin(2*PI*t/3.2))`;
  } else if (requested.includes("push-in") || requested.includes("zoom")) {
    x = `(iw-1080)*(0.5+${0.06 * direction}*${t})`;
    y = `(ih-1920)*(0.5+0.018*sin(2*PI*t/3.1))`;
  } else if (requested.includes("handheld") || requested.includes("micro")) {
    x = `(iw-1080)*(0.5+0.018*sin(2*PI*t/0.47))`;
    y = `(ih-1920)*(0.5+0.014*cos(2*PI*t/0.61))`;
  } else {
    // Every shot gets a tiny, different drift instead of a dead freeze.
    x = `(iw-1080)*(0.5+${(0.010 + (index % 3) * 0.004) * direction}*sin(2*PI*t/3.7))`;
    y = `(ih-1920)*(0.5+${0.008 + (index % 2) * 0.003}*sin(2*PI*t/4.1))`;
  }

  const crop = String(shot.crop || "CENTER").toUpperCase();
  if (crop === "FACE") y = `${y}-110`;
  if (crop === "PRODUCT") y = `${y}+28`;
  if (crop === "ACTION" && !requested.includes("pan")) x = `${x}+35`;

  const filters = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=1080:1920:x='${x}':y='${y}'`,
    "fps=30",
  ];

  if (Number.isFinite(plannedSpeed) && plannedSpeed > 0.5 && plannedSpeed < 1.8 && Math.abs(plannedSpeed - 1) > 0.01) {
    filters.push(`setpts=${(1 / plannedSpeed).toFixed(3)}*PTS`);
  }

  return filters;
}

function treatmentFilters(treatment: string, role: Role) {
  const t = treatment.toLowerCase();
  const parts: string[] = [];

  if (t.includes("warm") || t.includes("gold") || t.includes("appetizing")) {
    parts.push("eq=contrast=1.06:saturation=1.14:brightness=0.012");
  } else if (t.includes("cool") || t.includes("blue")) {
    parts.push("eq=contrast=1.04:saturation=1.04:brightness=0");
  } else if (t.includes("moody") || t.includes("dark")) {
    parts.push("eq=contrast=1.10:saturation=1.05:brightness=-0.015");
  } else if (t.includes("bright") || t.includes("clean")) {
    parts.push("eq=contrast=1.04:saturation=1.08:brightness=0.018");
  } else if (t.includes("punch") || role === "HOOK" || role === "CTA") {
    parts.push("eq=contrast=1.07:saturation=1.08:brightness=0.008");
  } else {
    parts.push("eq=contrast=1.03:saturation=1.04:brightness=0.004");
  }

  parts.push(t.includes("soft") || t.includes("natural")
    ? "unsharp=5:5:0.22:5:5:0"
    : "unsharp=5:5:0.38:5:5:0");

  return parts;
}

function makeCaptionChunks(
  captions: Caption[],
  shot: Shot,
  mode: Shot["caption_mode"]
) {
  if (!mode || mode === "NONE") return [];

  return captions
    .filter(
      c =>
        c.filename === shot.source_filename &&
        c.end > shot.start &&
        c.start < shot.end &&
        c.text.trim()
    )
    .flatMap(c => {
      const overlapStart = Math.max(shot.start, c.start);
      const overlapEnd = Math.min(shot.end, c.end);
      if (overlapEnd <= overlapStart) return [];

      const localStart = overlapStart - shot.start;
      const localEnd = overlapEnd - shot.start;

      if (mode === "WORD_BY_WORD" && Array.isArray(c.words) && c.words.length) {
        return c.words
          .filter(w => w.end > overlapStart && w.start < overlapEnd)
          .map(w => ({
            text: w.word,
            start: Math.max(0, w.start - shot.start),
            end: Math.min(shot.end - shot.start, w.end - shot.start),
          }))
          .filter(x => x.end > x.start);
      }

      const words = c.text.trim().split(/\s+/).filter(Boolean);
      const chunkSize = mode === "PHRASE" ? 4 : 3;
      const result: { text: string; start: number; end: number }[] = [];

      for (let i = 0; i < words.length; i += chunkSize) {
        const group = words.slice(i, i + chunkSize);
        const a = localStart + (localEnd - localStart) * (i / words.length);
        const b =
          localStart +
          (localEnd - localStart) *
            Math.min(1, (i + group.length) / words.length);

        if (b > a) {
          result.push({ text: group.join(" "), start: a, end: b });
        }
      }

      return result;
    });
}

function getFont() {
  return "C:/Windows/Fonts/arialbd.ttf";
}

async function findFfprobe(ffmpegPath: string) {
  const candidates = [
    path.join(path.dirname(ffmpegPath), "ffprobe.exe"),
    "C:\\Users\\EPIVATIKOS\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg.Essentials_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.1-essentials_build\\bin\\ffprobe.exe",
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  try {
    const { stdout } = await execFileAsync("where.exe", ["ffprobe"], { windowsHide: true });
    const first = stdout.split(/\r?\n/).map(x => x.trim()).find(Boolean);
    if (first) return first;
  } catch {}

  return null;
}


async function hasAudioStream(ffprobePath: string, file: string) {
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", file],
      { windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    return Boolean(stdout.trim());
  } catch {
    return false;
  }
}

async function mediaDuration(binary: string, file: string) {
  try {
    const { stdout } = await execFileAsync(
      binary,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
      { windowsHide: true, maxBuffer: 1024 * 1024 }
    );
    const value = Number.parseFloat(stdout.trim());
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}


type ReviewCacheEntry = {
  id: string;
  videoPath: string;
  createdAt: number;
  expiresAt: number;
};

const globalReviewCache =
  globalThis as typeof globalThis & {
    __ATLAS_REVIEW_CACHE__?: Map<string, ReviewCacheEntry>;
  };

function getReviewCache() {
  if (!globalReviewCache.__ATLAS_REVIEW_CACHE__) {
    globalReviewCache.__ATLAS_REVIEW_CACHE__ =
      new Map<string, ReviewCacheEntry>();
  }

  const cache = globalReviewCache.__ATLAS_REVIEW_CACHE__;
  const now = Date.now();

  for (const [id, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(id);
  }

  return cache;
}

function createReviewId() {
  const timestamp = Date.now().toString(16);
  const random = crypto.randomUUID().replace(/-/g, "");

  return `${timestamp}-${random}`;
}

export async function POST(request: NextRequest) {
  let tempDir = "";

  try {
    console.log("================================");
    console.log("ATLAS REAL AI EDIT RENDER V6 PRO");
    console.log("================================");

    const ffmpegPath = await findFfmpeg();
    console.log("ATLAS FFmpeg:", ffmpegPath);

    const formData = await request.formData();

    const files = formData
      .getAll("clips")
      .filter((v): v is File => v instanceof File);

    if (!files.length) {
      return NextResponse.json(
        { error: "No video clips were uploaded." },
        { status: 400 }
      );
    }

    // MASTER DIRECTOR is the source of truth.
    const masterRaw = formData.get("masterPlan");
    let masterPlan: MasterPlan | null = null;

    if (typeof masterRaw === "string") {
      try {
        const parsed = JSON.parse(masterRaw);
        if (parsed && Array.isArray(parsed.shots)) {
          masterPlan = parsed;
        }
      } catch (e) {
        console.warn("ATLAS masterPlan parse failed:", e);
      }
    }

    // Legacy plan is only a fallback for old runs.
    const legacyRaw = formData.get("editPlan");
    let legacy: any[] = [];

    if (typeof legacyRaw === "string") {
      try {
        const parsed = JSON.parse(legacyRaw);
        if (Array.isArray(parsed)) legacy = parsed;
      } catch {}
    }

    const captionsRaw = formData.get("captions");
    let captions: Caption[] = [];

    if (typeof captionsRaw === "string") {
      try {
        const parsed = JSON.parse(captionsRaw);

        if (Array.isArray(parsed)) {
          captions = parsed
            .filter(
              c =>
                c &&
                typeof c.filename === "string" &&
                typeof c.text === "string"
            )
            .map((c, i) => ({
              id: String(c.id ?? `speech-${i + 1}`),
              filename: c.filename,
              start: Number(c.start) || 0,
              end: Number(c.end) || 0,
              text: String(c.text).trim(),
              words: Array.isArray(c.words)
                ? c.words
                    .map((w: any) => ({
                      word: String(w.word ?? "").trim(),
                      start: Number(w.start),
                      end: Number(w.end),
                    }))
                    .filter(
                      (w: any) =>
                        w.word &&
                        Number.isFinite(w.start) &&
                        Number.isFinite(w.end) &&
                        w.end > w.start
                    )
                : [],
            }))
            .filter(c => c.text && c.end > c.start);
        }
      } catch (e) {
        console.warn("ATLAS captions parse failed:", e);
      }
    }

    const businessProfileRaw = formData.get("businessProfile");
    let businessProfile: any = {};
    if (typeof businessProfileRaw === "string") {
      try {
        const parsed = JSON.parse(businessProfileRaw);
        if (parsed && typeof parsed === "object") businessProfile = parsed;
      } catch {}
    }

    const voiceValue = formData.get("voice");
    const voiceFile = voiceValue instanceof File && voiceValue.size > 0 ? voiceValue : null;
    const musicValue = formData.get("music");
    const musicFile = musicValue instanceof File && musicValue.size > 0 ? musicValue : null;

    console.log(
      `ATLAS AUDIO INPUTS: voice=${voiceFile ? voiceFile.name : "none"} music=${musicFile ? musicFile.name : "none"}`
    );

    const shots: Shot[] = masterPlan?.shots?.length
      ? masterPlan.shots
      : legacy.map((x, i) => ({
          id: `legacy-${i + 1}`,
          role:
            x.role === "CTA"
              ? "CTA"
              : x.role === "HOOK"
                ? "HOOK"
                : "STORY",
          source_filename: String(x.filename || ""),
          start: Number(x.start) || 0,
          end: Number(x.end) || 3,
          purpose: "",
          visual_action: "",
          visual_treatment: "",
          crop: "CENTER",
          zoom: 1.04,
          transition_in: "CUT",
          transition_out: "CUT",
          on_screen_text: "",
          caption_mode: "NONE",
          caption_emphasis: [],
          music_intensity: 0,
          voice_priority: 1,
        }));

    if (!shots.length) {
      return NextResponse.json(
        { error: "No executable Master Edit Plan was received." },
        { status: 400 }
      );
    }

    const renderEngine = String(formData.get("renderEngine") || "remotion").toLowerCase();

    if (renderEngine === "remotion") {
      console.log("================================");
      console.log("ATLAS REMOTION PRO EDIT ENGINE V1");
      console.log("================================");
      const remotionBuffer = await renderAtlasWithRemotion({ files, shots, voiceFile, musicFile, musicVolume: 0.12 });
      const reviewDir = path.join(os.tmpdir(), "atlas-render-review-cache");
      await fs.mkdir(reviewDir, { recursive: true });
      const reviewId = createReviewId();
      const reviewPath = path.join(reviewDir, `${reviewId}.mp4`);
      await fs.writeFile(reviewPath, remotionBuffer);
      const now = Date.now();
      getReviewCache().set(reviewId, { id: reviewId, videoPath: reviewPath, createdAt: now, expiresAt: now + 30 * 60 * 1000 });
      console.log("ATLAS REMOTION REVIEW CACHE CREATED:", reviewId, reviewPath);
      return new NextResponse(remotionBuffer, { status: 200, headers: { "Content-Type": "video/mp4", "Content-Disposition": 'attachment; filename="atlas-remotion-reel.mp4"', "Content-Length": String(remotionBuffer.length), "Cache-Control": "no-store", "X-Atlas-Review-Id": reviewId, "X-Atlas-Render-Engine": "remotion", "Access-Control-Expose-Headers": "X-Atlas-Review-Id, X-Atlas-Render-Engine" } });
    }

    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "atlas-scene-render-v3-")
    );

    let voicePath = "";
    let musicPath = "";

    if (voiceFile) {
      voicePath = path.join(tempDir, "voice-input.mp3");
      await fs.writeFile(voicePath, Buffer.from(await voiceFile.arrayBuffer()));
    }

    if (musicFile) {
      const ext = (musicFile.name.split(".").pop() || "wav").toLowerCase();
      musicPath = path.join(tempDir, `music-input.${ext}`);
      await fs.writeFile(musicPath, Buffer.from(await musicFile.arrayBuffer()));
    }

    const inputByName = new Map<string, string>();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = (file.name.split(".").pop() || "mp4").toLowerCase();
      const safeExt = [
        "mp4",
        "mov",
        "m4v",
        "webm",
        "mkv",
        "avi",
      ].includes(ext)
        ? ext
        : "mp4";

      const inputPath = path.join(
        tempDir,
        `input-${i + 1}.${safeExt}`
      );

      await fs.writeFile(
        inputPath,
        Buffer.from(await file.arrayBuffer())
      );

      inputByName.set(file.name, inputPath);

      console.log(
        `ATLAS INPUT ${i + 1}: ${file.name}`
      );
    }

    const segmentFiles: string[] = [];
    const font = getFont();

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      const inputPath = inputByName.get(
        shot.source_filename
      );

      if (!inputPath) {
        console.warn(
          `ATLAS: source not uploaded: ${shot.source_filename}`
        );
        continue;
      }

      const start = Math.max(
        0,
        Number(shot.start) || 0
      );

      let end = Math.max(
        start + 0.5,
        Number(shot.end) || start + 2.5
      );

      const maxDuration =
        shot.role === "HOOK" ||
        shot.role === "CTA"
          ? 3.8
          : 5.5;

      end = Math.min(
        end,
        start + maxDuration
      );

      const duration = end - start;

      console.log(
        `ATLAS SHOT ${i + 1}: ${shot.role} ${shot.source_filename} ${start.toFixed(
          2
        )}-${end.toFixed(2)} | crop=${shot.crop} zoom=${
          shot.zoom
        } in=${shot.transition_in} out=${
          shot.transition_out
        }`
      );

      const filters: string[] = [];

      // 1. Social vertical framing + AI-selected zoom/motion.
      filters.push(...motionFilter(shot, i, duration));

      // 2. AI-selected visual treatment.
      filters.push(
        ...treatmentFilters(
          String(shot.visual_treatment || ""),
          shot.role
        )
      );

      // 3. Deterministic transition treatment.
      if (shot.transition_in === "DISSOLVE") {
        filters.push(
          `fade=t=in:st=0:d=0.18`
        );
      } else if (
        shot.transition_in === "WHIP" ||
        shot.transition_in === "MATCH"
      ) {
        filters.push(
          "eq=contrast=1.09:saturation=1.08"
        );
      }

      if (shot.transition_out === "DISSOLVE") {
        filters.push(
          `fade=t=out:st=${Math.max(
            0,
            duration - 0.18
          ).toFixed(3)}:d=0.18`
        );
      }

      // 4. Real speech captions.
      const captionChunks =
        makeCaptionChunks(
          captions,
          shot,
          shot.caption_mode
        );

      for (
        let c = 0;
        c < captionChunks.length;
        c++
      ) {
        const item =
          captionChunks[c];

        const captionPath =
          path.join(
            tempDir,
            `shot-${i + 1}-caption-${c + 1}.txt`
          );

        await fs.writeFile(
          captionPath,
          item.text,
          "utf8"
        );

        const emphasis = (shot.caption_emphasis || []).map(x => x.toLowerCase());
        const isEmphasis = emphasis.some(x => item.text.toLowerCase().includes(x));
        filters.push(
          animatedTextFilter(
            font,
            captionPath,
            isEmphasis ? 88 : 72,
            item.start,
            Math.max(item.end, item.start + 0.08),
            isEmphasis ? "WORD_EMPHASIS BOX" : "CLEAN",
            shot.caption_mode === "WORD_BY_WORD" ? "WORD_POP" : "FADE_UP",
            "LOWER"
          )
        );
      }

      // 5. AI-planned on-screen text.
      if (
        shot.on_screen_text?.trim()
      ) {
        const overlayPath =
          path.join(
            tempDir,
            `shot-${i + 1}-overlay.txt`
          );

        await fs.writeFile(
          overlayPath,
          shot.on_screen_text.trim(),
          "utf8"
        );

        const overlayStart = shot.role === "HOOK" ? 0.02 : 0.035;
        const overlayEnd = Math.max(0.35, duration - (shot.role === "CTA" ? 0.02 : 0.035));
        filters.push(
          ...(await buildKineticTextFilters(
            font,
            tempDir,
            shot.on_screen_text.trim(),
            overlayStart,
            overlayEnd,
            shot.role === "HOOK" ? 92 : shot.role === "CTA" ? 84 : 72,
            String(shot.text_style || shot.role),
            String(shot.text_animation || "FADE"),
            String(shot.text_position || (shot.role === "CTA" ? "CENTER" : "TOP")),
            shot.role
          ))
        );
      }

      filters.push(
        "format=yuv420p"
      );

      const outputPath =
        path.join(
          tempDir,
          `segment-${i + 1}.mp4`
        );

      const args = [
        "-y",
        "-ss",
        start.toFixed(3),
        "-i",
        inputPath,
        "-t",
        duration.toFixed(3),
        "-vf",
        filters.join(","),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "44100",
        "-ac",
        "2",
        "-af",
        "aresample=44100:async=1:first_pts=0",
        "-movflags",
        "+faststart",
        "-shortest",
        outputPath,
      ];

      try {
        await execFileAsync(
          ffmpegPath,
          args,
          {
            windowsHide: true,
            maxBuffer:
              1024 * 1024 * 8,
          }
        );
      } catch (error: any) {
        console.error(
          `ATLAS SHOT ${i + 1} FAILED`,
          error?.stderr ||
            error?.message
        );

        throw new Error(
          `Render failed on shot ${
            i + 1
          }: ${
            error?.stderr ||
            error?.message
          }`
        );
      }

      await fs.access(
        outputPath
      );

      segmentFiles.push(
        outputPath
      );
    }

    if (!segmentFiles.length) {
      return NextResponse.json(
        {
          error:
            "ATLAS could not render any planned shots.",
        },
        { status: 500 }
      );
    }

    // Final editorial assembly: honor requested transitions between shots.
    // CUT stays lossless/fast; DISSOLVE/WHIP/MATCH use real FFmpeg xfade.
    const segmentDurations: number[] = [];
    for (const segment of segmentFiles) {
      const d = await mediaDuration(await findFfprobe(ffmpegPath) || ffmpegPath, segment);
      segmentDurations.push(Math.max(0.25, d));
    }

    let silentVideoPath = path.join(tempDir, "atlas-video-only.mp4");
    const hasFancyTransition = shots.slice(0, segmentFiles.length - 1).some((shot: any) => {
      const t = String(shot.transition_out || "CUT").toUpperCase();
      return t === "DISSOLVE" || t === "WHIP" || t === "MATCH";
    });

    if (segmentFiles.length === 1 || !hasFancyTransition) {
      const concatFile = path.join(tempDir, "concat.txt");
      const concat = segmentFiles.map(file => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n");
      await fs.writeFile(concatFile, concat, "utf8");
      await execFileAsync(ffmpegPath, [
        "-y", "-f", "concat", "-safe", "0", "-i", concatFile,
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", silentVideoPath,
      ], { windowsHide: true, maxBuffer: 1024 * 1024 * 8 });
    } else {
      const inputs: string[] = [];
      const labels: string[] = [];
      segmentFiles.forEach((file, i) => { inputs.push("-i", file); labels.push(`[${i}:v]`); });
      let graph = "";
      let current = labels[0];
      let currentDuration = segmentDurations[0];
      for (let i = 1; i < labels.length; i++) {
        const raw = String(shots[i - 1]?.transition_out || "CUT").toUpperCase();
        const transition = raw === "WHIP" ? "wiperight" : raw === "MATCH" ? "smoothleft" : "fade";
        const d = Math.min(0.16, Math.max(0.08, segmentDurations[i] * 0.08));
        const offset = Math.max(0, currentDuration - d);
        const out = `[vx${i}]`;
        graph += `${current}${labels[i]}xfade=transition=${transition}:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}${out};`;
        current = out;
        currentDuration = currentDuration + segmentDurations[i] - d;
      }
      graph += `${current}format=yuv420p[vout]`;
      await execFileAsync(ffmpegPath, [
        "-y", ...inputs, "-filter_complex", graph, "-map", "[vout]",
        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", silentVideoPath,
      ], { windowsHide: true, maxBuffer: 1024 * 1024 * 8 });
    }

    const finalPath = path.join(tempDir, "atlas-reel.mp4");
    const ffprobePath = await findFfprobe(ffmpegPath);
    const durationBinary = ffprobePath || ffmpegPath;

    const videoDuration = await mediaDuration(durationBinary, silentVideoPath);
    const voiceDuration = voicePath
      ? await mediaDuration(durationBinary, voicePath)
      : 0;

    // The visual edit is the editorial clock.
    // NEVER freeze/extend the last frame to accommodate a long voiceover.
    const targetDuration = videoDuration;

    if (voiceDuration > videoDuration + 1.0) {
      console.warn(
        `ATLAS VOICE LONGER THAN VISUAL CUT: voice=${voiceDuration.toFixed(2)}s video=${videoDuration.toFixed(2)}s. Voice will be trimmed to the visual edit.`
      );
    }

    const requestedSfx = shots.flatMap((s: any) => Array.isArray(s.sfx) ? s.sfx : []).filter(Boolean);
    console.log(`ATLAS EDIT TREATMENT: text=${shots.filter((s:any)=>s.on_screen_text).length} motion=${shots.filter((s:any)=>s.motion).length} transitions=${shots.filter((s:any)=>String(s.transition_out||"CUT") !== "CUT").length} sfx=${requestedSfx.length}`);
    console.log(`ATLAS TIMELINE: video=${videoDuration.toFixed(2)}s voice=${voiceDuration.toFixed(2)}s final=${targetDuration.toFixed(2)}s`);

    const audioInputs: string[] = [];
    const audioLabels: string[] = [];
    const filterParts: string[] = [];
    const ffprobeForAudio = await findFfprobe(ffmpegPath);


    filterParts.push(
      `[0:v]trim=duration=${targetDuration.toFixed(3)},setpts=PTS-STARTPTS[vout]`
    );

    let nextInput = 1;

    if (voicePath) {
      audioInputs.push("-i", voicePath);
      filterParts.push(
        `[${nextInput}:a]aresample=44100,apad,atrim=0:${targetDuration.toFixed(3)},volume=1.0[voice]`
      );
      audioLabels.push("[voice]");
      nextInput++;
    }

    if (musicPath) {
      audioInputs.push("-stream_loop", "-1", "-i", musicPath);
      const musicInputIndex = nextInput;
      const globalAudio = masterPlan?.global_audio || {};
      const plannedIntensity = clamp(Number(globalAudio.music_intensity) || 0.72, 0.15, 1);
      const baseMusicVolume = voicePath ? 0.24 : 0.42;

      filterParts.push(
        `[${musicInputIndex}:a]aresample=44100,volume=${(baseMusicVolume * plannedIntensity).toFixed(3)},atrim=0:${targetDuration.toFixed(3)},afade=t=in:st=0:d=0.25,afade=t=out:st=${Math.max(0, targetDuration - 0.45).toFixed(3)}:d=0.45[musicRaw]`
      );

      if (voicePath && globalAudio.duck_music_under_speech !== false) {
        filterParts.push(
          `[musicRaw][voice]sidechaincompress=threshold=0.035:ratio=8:attack=12:release=220:makeup=1[music]`
        );
        console.log("ATLAS AUDIO: real voice-driven music duck enabled");
      } else {
        filterParts.push("[musicRaw]anull[music]");
      }

      audioLabels.push("[music]");
      nextInput++;
    }


    // Preserve a controlled amount of ORIGINAL FOOTAGE AUDIO when available.
    // This gives real water/machine/brush ambience instead of relying only on
    // procedural SFX. AI-generated cues remain on top for editorial emphasis.
    if (ffprobeForAudio) {
      let naturalClock = 0;
      for (let i = 0; i < shots.length; i++) {
        const shot = shots[i] as Shot;
        const sourcePath = inputByName.get(shot.source_filename);
        const shotDur = segmentDurations[i] || Math.max(0.25, Number(shot.end || 0) - Number(shot.start || 0));
        if (!sourcePath) {
          naturalClock += shotDur;
          continue;
        }
        const usable = await hasAudioStream(ffprobeForAudio, sourcePath);
        if (!usable) {
          naturalClock += shotDur;
          continue;
        }
        const inputIndex = nextInput++;
        audioInputs.push("-i", sourcePath);
        const label = `[nat${i}]`;
        const startAt = Math.max(0, Number(shot.start) || 0);
        const endAt = Math.max(startAt + 0.1, Number(shot.end) || startAt + shotDur);
        // Keep real-world ambience quiet enough to sit below voice/music.
        filterParts.push(
          `[${inputIndex}:a]atrim=start=${startAt.toFixed(3)}:end=${endAt.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,volume=0.22,afade=t=in:st=0:d=0.04,afade=t=out:st=${Math.max(0.05, shotDur - 0.08).toFixed(3)}:d=0.08,adelay=${Math.round(naturalClock * 1000)}|${Math.round(naturalClock * 1000)}${label}`
        );
        audioLabels.push(label);
        naturalClock += shotDur;
        if (i < shots.length - 1) {
          const rawTransition = String(shots[i]?.transition_out || "CUT").toUpperCase();
          if (rawTransition === "DISSOLVE" || rawTransition === "WHIP" || rawTransition === "MATCH") {
            const overlap = Math.min(0.16, Math.max(0.08, (segmentDurations[i + 1] || 0.25) * 0.08));
            naturalClock = Math.max(0, naturalClock - overlap);
          }
        }
      }
      console.log(`ATLAS NATURAL SOURCE AUDIO: ${audioLabels.filter(x => x.startsWith("[nat")).length} shot sources preserved`);
    }

    // Automatic editorial sound design. Explicit AI cues win; when the AI is
    // silent, derive physical/editorial cues from what the shot actually does.
    const sfxSpecs: Array<{ name: string; at: number; shotIndex: number }> = [];
    let shotClock = 0;
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i] as Shot;
      const shotDur = segmentDurations[i] || Math.max(0.25, Number(shot.end || 0) - Number(shot.start || 0));
      const explicit = Array.isArray(shot.sfx) ? shot.sfx.map(normalizeSfxName).filter(Boolean) : [];
      const cues = explicit.length ? explicit : deriveAutoSfx(shot, i);

      // Place physical cues slightly inside the action, and CTA/reveal cues
      // close to the visual emphasis point rather than always at frame 0.
      cues.slice(0, 2).forEach((name, cueIndex) => {
        const fraction = shot.role === "HOOK" ? 0.10 : name.includes("REVEAL") || name.includes("CTA") ? 0.68 : cueIndex === 0 ? 0.16 : 0.52;
        const at = shotClock + Math.min(Math.max(0.08, shotDur * fraction), Math.max(0.08, shotDur - 0.08));
        sfxSpecs.push({
          name,
          at: Math.max(0, Math.min(targetDuration - 0.05, at)),
          shotIndex: i,
        });
      });
      shotClock += shotDur;
    }

    const makeSfxFilter = (name: string, label: string, delay: number) => {
      const n = normalizeSfxName(name);
      let source = "aevalsrc='0':s=44100:d=0.08";
      let processing = "volume=0.0";

      if (n.includes("WHOOSH") || n.includes("SWISH")) {
        source = "aevalsrc='0.20*sin(2*PI*(5200-4200*t)*t)*exp(-10*t)':s=44100:d=0.24";
        processing = "highpass=f=600,lowpass=f=7600,afade=t=in:st=0:d=0.03,afade=t=out:st=0.13:d=0.11,volume=0.13";
      } else if (n.includes("WATER")) {
        source = "anoisesrc=color=white:duration=0.32:amplitude=0.24";
        processing = "highpass=f=700,lowpass=f=7200,volume=0.075,afade=t=in:st=0:d=0.02,afade=t=out:st=0.20:d=0.12";
      } else if (n.includes("FOAM")) {
        source = "anoisesrc=color=pink:duration=0.30:amplitude=0.18";
        processing = "highpass=f=900,lowpass=f=4200,volume=0.045,afade=t=in:st=0:d=0.04,afade=t=out:st=0.18:d=0.12";
      } else if (n.includes("WIPE") || n.includes("TEXTURE")) {
        source = "anoisesrc=color=brown:duration=0.22:amplitude=0.17";
        processing = "highpass=f=500,lowpass=f=3600,volume=0.055,afade=t=in:st=0:d=0.025,afade=t=out:st=0.12:d=0.10";
      } else if (n.includes("MACHINE")) {
        source = "aevalsrc='0.16*sin(2*PI*95*t)+0.07*sin(2*PI*190*t)':s=44100:d=0.34";
        processing = "lowpass=f=1200,volume=0.05,afade=t=in:st=0:d=0.06,afade=t=out:st=0.23:d=0.11";
      } else if (n.includes("REVEAL") || n.includes("IMPACT")) {
        source = "aevalsrc='0.34*sin(2*PI*150*t)*exp(-13*t)+0.10*sin(2*PI*620*t)*exp(-25*t)':s=44100:d=0.22";
        processing = "lowpass=f=2600,afade=t=out:st=0.025:d=0.195,volume=0.16";
      } else if (n.includes("CTA") || n.includes("CLICK")) {
        source = "aevalsrc='0.26*sin(2*PI*1450*t)*exp(-34*t)+0.08*sin(2*PI*2100*t)*exp(-50*t)':s=44100:d=0.09";
        processing = "highpass=f=800,afade=t=out:st=0.012:d=0.078,volume=0.10";
      } else if (n.includes("HIT")) {
        source = "aevalsrc='0.40*sin(2*PI*175*t)*exp(-17*t)+0.08*sin(2*PI*700*t)*exp(-28*t)':s=44100:d=0.16";
        processing = "lowpass=f=2100,afade=t=out:st=0.025:d=0.135,volume=0.15";
      } else if (n.includes("CRUNCH")) {
        source = "anoisesrc=color=white:duration=0.16:amplitude=0.22";
        processing = "highpass=f=1200,lowpass=f=6500,afade=t=out:st=0.03:d=0.13,volume=0.09";
      } else if (n.includes("SIZZLE")) {
        source = "anoisesrc=color=pink:duration=0.24:amplitude=0.17";
        processing = "highpass=f=1800,lowpass=f=9000,volume=0.065,afade=t=in:st=0:d=0.03,afade=t=out:st=0.13:d=0.11";
      } else if (n.includes("RISER")) {
        source = "aevalsrc='0.20*sin(2*PI*(300+4200*t)*t)':s=44100:d=0.34";
        processing = "highpass=f=250,afade=t=in:st=0:d=0.20,afade=t=out:st=0.27:d=0.07,volume=0.08";
      }

      return `${source},${processing},adelay=${delay}|${delay}${label}`;
    };

    sfxSpecs.forEach((fx, i) => {
      const label = `[sfx${i}]`;
      const delay = Math.round(fx.at * 1000);
      filterParts.push(makeSfxFilter(fx.name, label, delay));
      audioLabels.push(label);
    });

    console.log(
      `ATLAS AUTO SFX: ${sfxSpecs.map((x) => `${x.name}@${x.at.toFixed(2)}s`).join(", ") || "none"}`
    );

    if (audioLabels.length) {
      filterParts.push(
        `${audioLabels.join("")}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,loudnorm=I=${Number(masterPlan?.global_audio?.target_lufs || -14).toFixed(1)}:TP=-1.5:LRA=11,alimiter=limit=0.95[aout]`
      );
    }

    const finalArgs = [
      "-y",
      "-i", silentVideoPath,
      ...audioInputs,
      "-filter_complex", filterParts.join(";"),
      "-map", "[vout]",
      ...(audioLabels.length ? ["-map", "[aout]"] : []),
      "-t", targetDuration.toFixed(3),
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      ...(audioLabels.length
        ? ["-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2"]
        : ["-an"]),
      "-movflags", "+faststart",
      finalPath,
    ];

    await execFileAsync(ffmpegPath, finalArgs, {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    });

    const videoBuffer =
      await fs.readFile(
        finalPath
      );

    console.log(
      "================================"
    );
    console.log(
      "ATLAS REAL AI EDIT COMPLETE V6 PRO"
    );
    console.log(
      `Shots rendered: ${segmentFiles.length}/${shots.length}`
    );
    console.log(`Voice baked: ${Boolean(voicePath)} | Music baked: ${Boolean(musicPath)}`);
    console.log(
      `Output bytes: ${videoBuffer.length}`
    );
    console.log(
      "================================"
    );

    const reviewDir = path.join(
      os.tmpdir(),
      "atlas-render-review-cache"
    );

    await fs.mkdir(reviewDir, { recursive: true });

    const reviewId = createReviewId();
    const reviewPath = path.join(
      reviewDir,
      `${reviewId}.mp4`
    );

    // Keep the review copy OUTSIDE tempDir because tempDir is deleted in finally.
    await fs.writeFile(reviewPath, videoBuffer);

    const now = Date.now();
    getReviewCache().set(reviewId, {
      id: reviewId,
      videoPath: reviewPath,
      createdAt: now,
      expiresAt: now + 30 * 60 * 1000,
    });

    console.log(
      "ATLAS REVIEW CACHE CREATED:",
      reviewId,
      reviewPath
    );

    return new NextResponse(
      videoBuffer,
      {
        status: 200,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Disposition":
            'attachment; filename="atlas-reel.mp4"',
          "Content-Length":
            String(videoBuffer.length),
          "Cache-Control": "no-store",
          "X-Atlas-Review-Id": reviewId,
          "Access-Control-Expose-Headers":
            "X-Atlas-Review-Id",
        },
      }
    );
  } catch (error: any) {
    console.error(
      "ATLAS REAL RENDER ERROR",
      error
    );

    return NextResponse.json(
      {
        error:
          error?.stderr ||
          error?.message ||
          "ATLAS render failed.",
      },
      { status: 500 }
    );
  } finally {
    if (tempDir) {
      await fs.rm(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      ).catch(() => {});
    }
  }
}
