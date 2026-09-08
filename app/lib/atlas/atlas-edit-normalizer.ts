import {
  ATLAS_EDIT_PLAN_VERSION,
  type AtlasEditPlanV1,
  type AtlasRole,
  type AtlasTransition,
  type AtlasMotion,
  type AtlasCropFocus,
  type AtlasCutOn,
  type AtlasBeatIntent,
  normalizeMusicCurve,
  normalizeSpeedCurve,
  deriveSfxEvents,
} from "./atlas-edit-contract";

type RawBeat = {
  id?: unknown;
  source_filename?: unknown;
  source_start?: unknown;
  source_end?: unknown;

  role?: unknown;
  purpose?: unknown;
  cut_reason?: unknown;
  transition_in?: unknown;
  transition_out?: unknown;

  motion?: unknown;
  zoom_start?: unknown;
  zoom_end?: unknown;
  speed?: unknown;
  speed_curve?: unknown;

  text?: unknown;
  text_style?: unknown;
  text_animation?: unknown;
  text_position?: unknown;
  emphasis_words?: unknown;

  sfx?: unknown;
  sfx_events?: unknown;

  source_audio_volume?: unknown;
  music_volume?: unknown;
  music_curve?: unknown;

  color_treatment?: unknown;
  brightness?: unknown;
  contrast?: unknown;
  saturation?: unknown;
  blur?: unknown;

  crop_focus?: unknown;
  editorial_score?: unknown;
  beat_intent?: unknown;
  cut_on?: unknown;
};

type RawEditDirectorOutput = {
  version?: unknown;
  editorial_intent?: unknown;
  hook_strategy?: unknown;
  music_strategy?: unknown;

  timeline?: unknown;

  creative?: unknown;
  music?: unknown;
  voice?: unknown;
  captions?: unknown;
  cover?: unknown;
  quality?: unknown;
};

export type AtlasNormalizerSource = {
  filename: string;
  duration: number;
};

const ROLES: AtlasRole[] = [
  "HOOK",
  "STORY",
  "PAYOFF",
  "CTA",
];

const TRANSITIONS: AtlasTransition[] = [
  "CUT",
  "DISSOLVE",
  "FADE",
  "WHIP",
  "MATCH",
  "ZOOM",
  "PUNCH",
  "SLIDE_LEFT",
  "SLIDE_RIGHT",
  "SLIDE_UP",
  "SLIDE_DOWN",
  "FLASH",
  "NONE",
];

const MOTIONS: AtlasMotion[] = [
  "STATIC",
  "PUSH_IN",
  "PULL_OUT",
  "PAN_LEFT",
  "PAN_RIGHT",
  "TILT_UP",
  "TILT_DOWN",
  "HANDHELD",
  "DRIFT",
];

const CROPS: AtlasCropFocus[] = [
  "NONE",
  "CENTER",
  "FACE",
  "PRODUCT",
  "ACTION",
  "TOP",
  "BOTTOM",
  "LEFT",
  "RIGHT",
];

const CUT_ON: AtlasCutOn[] = [
  "ACTION",
  "MOTION",
  "WORD",
  "MUSIC",
  "REVEAL",
  "BREATH",
  "IMPACT",
  "BEAT",
  "NONE",
];

const BEAT_INTENTS: AtlasBeatIntent[] = [
  "HOOK_IMPACT",
  "PROBLEM",
  "ACTION",
  "PROOF",
  "ESCALATION",
  "TRANSFORMATION",
  "HERO",
  "CTA",
  "REACTION",
  "BRIDGE",
  "BREATH",
];

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function numberValue(
  value: unknown,
  fallback: number,
): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const normalized = String(value || "").trim().toUpperCase() as T;
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeBeatIntent(value: unknown): AtlasBeatIntent {
  return enumValue(value, BEAT_INTENTS, "ACTION");
}

function normalizeRole(
  value: unknown,
  index: number,
  total: number,
): AtlasRole {
  const explicit = String(value || "")
    .trim()
    .toUpperCase() as AtlasRole;

  if (ROLES.includes(explicit)) {
    return explicit;
  }

  if (index === 0) {
    return "HOOK";
  }

  if (index === total - 1) {
    return "CTA";
  }

  return "STORY";
}

function normalizeTimeline(
  rawTimeline: unknown,
): RawBeat[] {
  if (Array.isArray(rawTimeline)) {
    return rawTimeline as RawBeat[];
  }

  if (
    rawTimeline &&
    typeof rawTimeline === "object" &&
    Array.isArray((rawTimeline as any).shots)
  ) {
    return (rawTimeline as any).shots as RawBeat[];
  }

  return [];
}

function normalizeText(
  beat: RawBeat,
) {
  const content = stringValue(beat.text);

  if (!content) {
    return undefined;
  }

  return {
    content,
    style: stringValue(beat.text_style, "DEFAULT"),
    animation: stringValue(beat.text_animation, "NONE"),
    position: stringValue(beat.text_position, "CENTER"),
    emphasisWords: Array.isArray(beat.emphasis_words)
      ? beat.emphasis_words.map(String).map((x: unknown) => String(x).trim()).filter(Boolean)
      : [],
  };
}

function normalizeSpeed(
  value: unknown,
): number {
  return clamp(
    numberValue(value, 1),
    0.25,
    3,
  );
}

function normalizeZoom(
  value: unknown,
): number {
  return clamp(
    numberValue(value, 1),
    1,
    1.45,
  );
}

function normalizeVolume(
  value: unknown,
  fallback: number,
): number {
  return clamp(
    numberValue(value, fallback),
    0,
    1,
  );
}

function normalizeShot(
  beat: RawBeat,
  index: number,
  total: number,
  sources: Map<string, AtlasNormalizerSource>,
): ReturnType<typeof buildShot> | null {
  const sourceFilename = stringValue(
    beat.source_filename,
  );

  if (!sourceFilename) {
    return null;
  }

  const source = sources.get(sourceFilename);

  if (!source) {
    return null;
  }

  const rawStart = numberValue(
    beat.source_start,
    0,
  );

  const rawEnd = numberValue(
    beat.source_end,
    Math.min(source.duration, rawStart + 1),
  );

  const sourceStart = clamp(
    rawStart,
    0,
    Math.max(0, source.duration - 0.25),
  );

  const sourceEnd = clamp(
    Math.max(sourceStart + 0.25, rawEnd),
    sourceStart + 0.25,
    source.duration,
  );

  const speed = normalizeSpeed(beat.speed);

  const zoomStart = normalizeZoom(
    beat.zoom_start,
  );

  const zoomEnd = normalizeZoom(
    beat.zoom_end,
  );

  const motion = enumValue(
    beat.motion,
    MOTIONS,
    "STATIC",
  );

  const cropFocus = enumValue(
    beat.crop_focus,
    CROPS,
    "CENTER",
  );

  const transitionIn = enumValue(
    beat.transition_in,
    TRANSITIONS,
    "CUT",
  );

  const transitionOut = enumValue(
    beat.transition_out,
    TRANSITIONS,
    "CUT",
  );

  const cutOn = enumValue(
    beat.cut_on,
    CUT_ON,
    "NONE",
  );

  const duration = Math.max(
    0.25,
    sourceEnd - sourceStart,
  );

  const sourceAudioVolume = normalizeVolume(
    beat.source_audio_volume,
    1,
  );

  const musicVolume = normalizeVolume(
    beat.music_volume,
    0,
  );

  const brightnessRaw = numberValue(
    beat.brightness,
    1,
  );

  const contrastRaw = numberValue(
    beat.contrast,
    1,
  );

  const saturationRaw = numberValue(
    beat.saturation,
    1,
  );

  const blurRaw = numberValue(
    beat.blur,
    0,
  );

  return buildShot({
    id:
      stringValue(beat.id) ||
      `shot-${index + 1}`,

    sourceFilename,

    role: normalizeRole(
      beat.role,
      index,
      total,
    ),

    purpose: stringValue(
      beat.purpose,
      stringValue(beat.cut_reason),
    ),

    cutReason: stringValue(
      beat.cut_reason,
    ),

    beatIntent: normalizeBeatIntent(
      beat.beat_intent,
    ),

    editorialScore: clamp(
      numberValue(beat.editorial_score, 0),
      0,
      100,
    ),

    sourceStart,
    sourceEnd,
    cutOn,

    transitionIn,
    transitionOut,

    motion,
    zoomStart,
    zoomEnd,
    cropFocus,

    speed,

    speedCurve: normalizeSpeedCurve(
      beat.speed_curve,
      speed,
    ),

    colorTreatment: stringValue(
      beat.color_treatment,
      "NONE",
    ),

    brightness: clamp(
      brightnessRaw,
      0,
      3,
    ),

    contrast: clamp(
      contrastRaw,
      0,
      3,
    ),

    saturation: clamp(
      saturationRaw,
      0,
      3,
    ),

    blur: clamp(
      blurRaw,
      0,
      50,
    ),

    text: normalizeText(beat),

    sourceAudioVolume,
    musicVolume,

    musicCurve: normalizeMusicCurve(
      beat.music_curve,
      musicVolume,
    ),

    sfx: Array.isArray(beat.sfx)
      ? beat.sfx
          .map(String)
          .map((x: unknown) => String(x).trim())
          .filter(Boolean)
      : [],

    sfxEvents: deriveSfxEvents(
      beat.sfx,
      beat.sfx_events,
      duration,
    ),
  });
}

function buildShot(input: {
  id: string;
  sourceFilename: string;

  role: AtlasRole;

  purpose: string;
  cutReason: string;
  beatIntent: AtlasBeatIntent;
  editorialScore: number;

  sourceStart: number;
  sourceEnd: number;
  cutOn: AtlasCutOn;

  transitionIn: AtlasTransition;
  transitionOut: AtlasTransition;

  motion: AtlasMotion;
  zoomStart: number;
  zoomEnd: number;
  cropFocus: AtlasCropFocus;

  speed: number;
  speedCurve: Array<{
    at: number;
    speed: number;
  }>;

  colorTreatment: string;
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;

  text:
    | {
        content: string;
        style: string;
        animation: string;
        position: string;
        emphasisWords: string[];
      }
    | undefined;

  sourceAudioVolume: number;
  musicVolume: number;

  musicCurve: Array<{
    at: number;
    level: number;
  }>;

  sfx: string[];

  sfxEvents: Array<{
    type: string;
    at: number;
    volume: number;
    duration?: number;
  }>;
}) {
  return {
    id: input.id,
    sourceFilename: input.sourceFilename,

    role: input.role,

    purpose: input.purpose,
    cutReason: input.cutReason,
    beatIntent: input.beatIntent,
    editorialScore: input.editorialScore,

    timing: {
      sourceStart: input.sourceStart,
      sourceEnd: input.sourceEnd,
      cutOn: input.cutOn,
    },

    transitionIn: input.transitionIn,
    transitionOut: input.transitionOut,

    motion: {
      type: input.motion,
      zoomStart: input.zoomStart,
      zoomEnd: input.zoomEnd,
      cropFocus: input.cropFocus,
    },

    speed: input.speed,
    speedCurve: input.speedCurve,

    visual: {
      colorTreatment: input.colorTreatment,
      brightness: input.brightness,
      contrast: input.contrast,
      saturation: input.saturation,
      blur: input.blur,
    },

    ...(input.text
      ? {
          text: {
            content: input.text.content,
            style: input.text.style,
            animation: input.text.animation,
            position: input.text.position,
            emphasisWords: input.text.emphasisWords,
          },
        }
      : {}),

    audio: {
      sourceAudioVolume: input.sourceAudioVolume,
      musicVolume: input.musicVolume,
      musicCurve: input.musicCurve,
      sfx: input.sfx,
      sfxEvents: input.sfxEvents,
    },
  };
}

function normalizeCreative(
  raw: RawEditDirectorOutput,
): AtlasEditPlanV1["creative"] {
  const creative =
    raw.creative &&
    typeof raw.creative === "object"
      ? (raw.creative as any)
      : {};

  return {
    objective:
      stringValue(
        creative.objective,
        stringValue(raw.editorial_intent),
      ),

    audience: stringValue(
      creative.audience,
      "GENERAL",
    ),

    tone: stringValue(
      creative.tone,
      "PROFESSIONAL",
    ),

    platform: stringValue(
      creative.platform,
      "REELS",
    ),

    aspectRatio: stringValue(
      creative.aspectRatio,
      "9:16",
    ),

    retentionStrategy:
      stringValue(
        creative.retentionStrategy,
        stringValue(raw.hook_strategy),
      ),
  };
}

function normalizeMusic(
  raw: RawEditDirectorOutput,
  shots: AtlasEditPlanV1["timeline"]["shots"],
): AtlasEditPlanV1["music"] {
  const music =
    raw.music &&
    typeof raw.music === "object"
      ? (raw.music as any)
      : {};

  const enabled =
    music.enabled === true ||
    shots.some(
      (shot) =>
        shot.audio.musicVolume > 0 ||
        shot.audio.musicCurve.some(
          (point) => point.level > 0,
        ),
    );

  const volume = normalizeVolume(
    music.volume,
    shots.length
      ? shots.reduce(
          (sum, shot) =>
            sum + shot.audio.musicVolume,
          0,
        ) / shots.length
      : 0,
  );

  return {
    enabled,
    volume,
    curve: normalizeMusicCurve(
      music.curve,
      volume,
    ),
  };
}

function normalizeVoice(
  raw: RawEditDirectorOutput,
): AtlasEditPlanV1["voice"] {
  const voice =
    raw.voice &&
    typeof raw.voice === "object"
      ? (raw.voice as any)
      : {};

  const mode = stringValue(
    voice.mode,
    "NONE",
  );

  const script = stringValue(
    voice.script,
  );

  const priority = enumValue(
    voice.priority,
    ["HIGH", "NORMAL", "LOW"] as const,
    "HIGH",
  );

  return {
    mode,
    script,
    priority,
  };
}

function normalizeCaptions(
  raw: RawEditDirectorOutput,
): AtlasEditPlanV1["captions"] {
  const captions =
    raw.captions &&
    typeof raw.captions === "object"
      ? (raw.captions as any)
      : {};

  return {
    enabled: captions.enabled === true,
    mode: stringValue(
      captions.mode,
      "NONE",
    ),
    style: stringValue(
      captions.style,
      "DEFAULT",
    ),
    emphasisWords: Array.isArray(
      captions.emphasisWords,
    )
      ? captions.emphasisWords
          .map(String)
          .map((x: unknown) => String(x).trim())
          .filter(Boolean)
      : [],
  };
}

function normalizeCover(
  raw: RawEditDirectorOutput,
): AtlasEditPlanV1["cover"] {
  const cover =
    raw.cover &&
    typeof raw.cover === "object"
      ? (raw.cover as any)
      : {};

  return {
    enabled: cover.enabled === true,
    shotId: stringValue(cover.shotId) || undefined,
    title: stringValue(cover.title) || undefined,
    subtitle:
      stringValue(cover.subtitle) || undefined,
  };
}

function normalizeQuality(
  raw: RawEditDirectorOutput,
  shotCount: number,
): AtlasEditPlanV1["quality"] {
  const quality =
    raw.quality &&
    typeof raw.quality === "object"
      ? (raw.quality as any)
      : {};

  return {
    targetDurationSeconds: Math.max(
      1,
      numberValue(
        quality.targetDurationSeconds,
        15,
      ),
    ),

    minimumBeats: Math.max(
      1,
      Math.floor(
        numberValue(
          quality.minimumBeats,
          Math.min(7, Math.max(1, shotCount)),
        ),
      ),
    ),

    maximumBeats: Math.max(
      1,
      Math.floor(
        numberValue(
          quality.maximumBeats,
          Math.max(12, shotCount),
        ),
      ),
    ),

    requireCta:
      quality.requireCta !== false,
  };
}

export function normalizeAtlasEditPlan(
  raw: RawEditDirectorOutput,
  sources: AtlasNormalizerSource[],
): AtlasEditPlanV1 {
  const sourceMap = new Map(
    sources.map((source) => [
      source.filename,
      source,
    ]),
  );

  const rawTimeline = normalizeTimeline(
    raw.timeline,
  );

  const shots = rawTimeline
    .map((beat, index) =>
      normalizeShot(
        beat,
        index,
        rawTimeline.length,
        sourceMap,
      ),
    )
    .filter(
      (
        shot,
      ): shot is NonNullable<typeof shot> =>
        shot !== null,
    );

  const quality = normalizeQuality(
    raw,
    shots.length,
  );

  const normalized: AtlasEditPlanV1 = {
    version: ATLAS_EDIT_PLAN_VERSION,

    creative:
      normalizeCreative(raw),

    timeline: {
      shots,
    },

    music: normalizeMusic(
      raw,
      shots,
    ),

    voice:
      normalizeVoice(raw),

    captions:
      normalizeCaptions(raw),

    cover:
      normalizeCover(raw),

    quality,
  };

  return normalized;
}