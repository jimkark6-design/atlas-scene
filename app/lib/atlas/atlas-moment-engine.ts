import type {
  AtlasBeatIntent,
  AtlasSourceAsset,
} from "./atlas-edit-contract";

export type AtlasMomentType =
  | "ACTION_PEAK"
  | "REVEAL"
  | "HERO_FRAME"
  | "MOTION_PEAK"
  | "REACTION"
  | "TRANSFORMATION"
  | "DETAIL"
  | "ESTABLISH"
  | "BEST_WINDOW"
  | "BREATH";

export type AtlasMomentSignal = {
  /** Absolute source time in seconds. */
  at: number;
  /** Optional signal strength 0..1. */
  score?: number;
  /** Optional semantic label from Vision / another detector. */
  type?: string;
};

export type AtlasMomentCandidate = {
  id: string;
  sourceFilename: string;
  type: AtlasMomentType;
  start: number;
  end: number;
  duration: number;
  score: number;
  confidence: number;
  beatFit: AtlasBeatIntent[];
  signals: string[];
  rationale: string;
};

export type AtlasMomentAnalysis = {
  filename?: string;
  duration?: number;

  /** Existing Vision metadata. */
  score?: number;
  shot_type?: string;
  strengths?: string[] | string;
  problems?: string[] | string;
  recommended_use?: string | string[];
  suggested_start?: number;
  suggested_end?: number;

  /** Optional future fine-grained detector output. */
  action_peaks?: AtlasMomentSignal[];
  motion_peaks?: AtlasMomentSignal[];
  reveals?: AtlasMomentSignal[];
  hero_frames?: AtlasMomentSignal[];
  reactions?: AtlasMomentSignal[];
  transformations?: AtlasMomentSignal[];

  /** Optional already-localized candidate windows. */
  moments?: Array<{
    type?: string;
    start?: number;
    end?: number;
    score?: number;
    confidence?: number;
    label?: string;
  }>;
};

export type AtlasMomentEngineOptions = {
  minDuration?: number;
  maxDuration?: number;
  windowStep?: number;
  maxCandidatesPerSource?: number;
};

const DEFAULTS: Required<AtlasMomentEngineOptions> = {
  minDuration: 0.35,
  maxDuration: 2.8,
  windowStep: 0.25,
  maxCandidatesPerSource: 18,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function finite(value: unknown, fallback = NaN): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(cleanString).filter(Boolean);
  }

  const single = cleanString(value);
  return single ? [single] : [];
}

function normalizeType(value: unknown): AtlasMomentType | null {
  const normalized = cleanString(value).toUpperCase();

  const aliases: Record<string, AtlasMomentType> = {
    ACTION: "ACTION_PEAK",
    ACTION_PEAK: "ACTION_PEAK",
    IMPACT: "ACTION_PEAK",
    REVEAL: "REVEAL",
    HERO: "HERO_FRAME",
    HERO_FRAME: "HERO_FRAME",
    BEST: "BEST_WINDOW",
    BEST_WINDOW: "BEST_WINDOW",
    MOTION: "MOTION_PEAK",
    MOTION_PEAK: "MOTION_PEAK",
    REACTION: "REACTION",
    TRANSFORMATION: "TRANSFORMATION",
    DETAIL: "DETAIL",
    CLOSEUP: "DETAIL",
    CLOSE_UP: "DETAIL",
    ESTABLISH: "ESTABLISH",
    ESTABLISHING: "ESTABLISH",
    BREATH: "BREATH",
  };

  return aliases[normalized] ?? null;
}

function beatFitForType(type: AtlasMomentType): AtlasBeatIntent[] {
  switch (type) {
    case "ACTION_PEAK":
      return ["ACTION", "ESCALATION", "HOOK_IMPACT"];
    case "REVEAL":
      return ["TRANSFORMATION", "HERO", "CTA"];
    case "HERO_FRAME":
      return ["HERO", "TRANSFORMATION", "CTA"];
    case "MOTION_PEAK":
      return ["HOOK_IMPACT", "ACTION", "ESCALATION"];
    case "REACTION":
      return ["REACTION", "PROOF", "HERO"];
    case "TRANSFORMATION":
      return ["TRANSFORMATION", "HERO", "CTA"];
    case "DETAIL":
      return ["ACTION", "PROOF", "HERO"];
    case "ESTABLISH":
      return ["BRIDGE", "PROBLEM"];
    case "BREATH":
      return ["BREATH", "BRIDGE"];
    case "BEST_WINDOW":
    default:
      return [
        "HOOK_IMPACT",
        "PROBLEM",
        "ACTION",
        "PROOF",
        "ESCALATION",
        "TRANSFORMATION",
        "HERO",
        "CTA",
      ];
  }
}

function roleCompatibility(
  type: AtlasMomentType,
  intent: AtlasBeatIntent,
): number {
  if (beatFitForType(type).includes(intent)) return 1;

  if (intent === "CTA" && type === "HERO_FRAME") return 0.95;
    if (intent === "HOOK_IMPACT" && type === "DETAIL") return 0.9;
  if (intent === "ACTION" && type === "MOTION_PEAK") return 0.95;

  return 0.55;
}

function signalScore(signals: AtlasMomentSignal[] | undefined): number {
  if (!Array.isArray(signals) || signals.length === 0) return 0;

  return clamp(
    signals.reduce((max, signal) => {
      const score = finite(signal?.score, 0.5);
      return Math.max(max, clamp(score, 0, 1));
    }, 0),
    0,
    1,
  );
}

function nearestSignal(
  signals: AtlasMomentSignal[] | undefined,
  at: number,
): AtlasMomentSignal | null {
  if (!Array.isArray(signals) || signals.length === 0) return null;

  let best: AtlasMomentSignal | null = null;
  let distance = Infinity;

  for (const signal of signals) {
    const signalAt = finite(signal?.at);
    if (!Number.isFinite(signalAt)) continue;

    const d = Math.abs(signalAt - at);
    if (d < distance) {
      distance = d;
      best = signal;
    }
  }

  return best;
}

function midpoint(start: number, end: number): number {
  return start + (end - start) / 2;
}

function boundedWindow(
  center: number,
  desiredDuration: number,
  sourceDuration: number,
): { start: number; end: number } {
  const duration = clamp(
    desiredDuration,
    DEFAULTS.minDuration,
    Math.max(DEFAULTS.minDuration, Math.min(DEFAULTS.maxDuration, sourceDuration)),
  );

  let start = center - duration / 2;
  let end = center + duration / 2;

  if (start < 0) {
    end -= start;
    start = 0;
  }

  if (end > sourceDuration) {
    start -= end - sourceDuration;
    end = sourceDuration;
  }

  start = clamp(start, 0, Math.max(0, sourceDuration - duration));
  end = clamp(end, start + DEFAULTS.minDuration, sourceDuration);

  return { start, end };
}

function candidateKey(
  filename: string,
  type: AtlasMomentType,
  start: number,
  end: number,
): string {
  return [
    filename,
    type,
    start.toFixed(3),
    end.toFixed(3),
  ].join(":");
}

function addCandidate(
  target: AtlasMomentCandidate[],
  analysis: AtlasMomentAnalysis,
  sourceDuration: number,
  type: AtlasMomentType,
  center: number,
  baseScore: number,
  confidence: number,
  signals: string[],
  rationale: string,
  options: Required<AtlasMomentEngineOptions>,
): void {
  if (!analysis.filename || sourceDuration <= 0) return;

  const desiredDuration = clamp(
    type === "HERO_FRAME" || type === "BEST_WINDOW" ? 1.6 : 0.9,
    options.minDuration,
    Math.min(options.maxDuration, sourceDuration),
  );

  const window = boundedWindow(center, desiredDuration, sourceDuration);
  const duration = window.end - window.start;

  if (duration < options.minDuration - 0.01) return;

  const visualScore = clamp(finite(analysis.score, 60) / 100, 0, 1);
  const finalScore = clamp(
    baseScore * 0.72 +
      visualScore * 0.18 +
      confidence * 0.1,
    0,
    1,
  );

  target.push({
    id: `moment-${target.length + 1}-${Math.round(center * 1000)}`,
    sourceFilename: analysis.filename,
    type,
    start: Number(window.start.toFixed(3)),
    end: Number(window.end.toFixed(3)),
    duration: Number(duration.toFixed(3)),
    score: Number(finalScore.toFixed(4)),
    confidence: Number(clamp(confidence, 0, 1).toFixed(4)),
    beatFit: beatFitForType(type),
    signals: [...new Set(signals.filter(Boolean))],
    rationale,
  });
}

function ingestExplicitMoments(
  analysis: AtlasMomentAnalysis,
  sourceDuration: number,
  target: AtlasMomentCandidate[],
  options: Required<AtlasMomentEngineOptions>,
): void {
  if (!Array.isArray(analysis.moments)) return;

  for (const moment of analysis.moments) {
    const type = normalizeType(moment?.type);
    if (!type) continue;

    const start = finite(moment?.start);
    const end = finite(moment?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }

    const safeStart = clamp(start, 0, sourceDuration);
    const safeEnd = clamp(end, safeStart, sourceDuration);

    if (safeEnd - safeStart < options.minDuration) continue;

    const center = midpoint(safeStart, safeEnd);
    const score = clamp(finite(moment?.score, 0.75), 0, 1);
    const confidence = clamp(finite(moment?.confidence, score), 0, 1);
    const label = cleanString(moment?.label);

    const desired = clamp(
      safeEnd - safeStart,
      options.minDuration,
      options.maxDuration,
    );

    const window = boundedWindow(center, desired, sourceDuration);

    target.push({
      id: `moment-explicit-${target.length + 1}`,
      sourceFilename: analysis.filename!,
      type,
      start: Number(window.start.toFixed(3)),
      end: Number(window.end.toFixed(3)),
      duration: Number((window.end - window.start).toFixed(3)),
      score: Number(score.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      beatFit: beatFitForType(type),
      signals: label ? [label] : ["explicit_moment"],
      rationale: label || `Vision provided a ${type} moment.`,
    });
  }
}

function ingestSignalFamily(
  analysis: AtlasMomentAnalysis,
  sourceDuration: number,
  target: AtlasMomentCandidate[],
  type: AtlasMomentType,
  family: AtlasMomentSignal[] | undefined,
  options: Required<AtlasMomentEngineOptions>,
): void {
  if (!Array.isArray(family)) return;

  for (const signal of family) {
    const at = finite(signal?.at);
    if (!Number.isFinite(at)) continue;

    const score = clamp(finite(signal?.score, 0.75), 0, 1);
    const confidence = clamp(0.55 + score * 0.4, 0, 1);

    addCandidate(
      target,
      analysis,
      sourceDuration,
      type,
      clamp(at, 0, sourceDuration),
      score,
      confidence,
      [cleanString(signal?.type), `${type.toLowerCase()}_signal`],
      `Temporal ${type.toLowerCase()} signal localized at ${at.toFixed(2)}s.`,
      options,
    );
  }
}

function addSuggestedWindow(
  analysis: AtlasMomentAnalysis,
  sourceDuration: number,
  target: AtlasMomentCandidate[],
  options: Required<AtlasMomentEngineOptions>,
): void {
  const suggestedStart = finite(analysis.suggested_start);
  const suggestedEnd = finite(analysis.suggested_end);

  if (
    !Number.isFinite(suggestedStart) ||
    !Number.isFinite(suggestedEnd) ||
    suggestedEnd <= suggestedStart
  ) {
    return;
  }

  const start = clamp(suggestedStart, 0, sourceDuration);
  const end = clamp(suggestedEnd, start, sourceDuration);
  const center = midpoint(start, end);

  addCandidate(
    target,
    analysis,
    sourceDuration,
    "BEST_WINDOW",
    center,
    0.78,
    0.72,
    ["vision_suggested_window"],
    "Vision supplied a recommended source window; preserved as a high-priority candidate.",
    options,
  );
}

function addFallbackWindows(
  analysis: AtlasMomentAnalysis,
  sourceDuration: number,
  target: AtlasMomentCandidate[],
  options: Required<AtlasMomentEngineOptions>,
): void {
  if (sourceDuration <= 0) return;

  const preferredDuration = clamp(
    Math.min(1.25, sourceDuration),
    options.minDuration,
    options.maxDuration,
  );

  const centers = [
    preferredDuration / 2,
    sourceDuration / 2,
    Math.max(preferredDuration / 2, sourceDuration - preferredDuration / 2),
  ];

  for (const center of [...new Set(centers.map((x) => Number(x.toFixed(3))))]) {
    addCandidate(
      target,
      analysis,
      sourceDuration,
      "BEST_WINDOW",
      center,
      0.48,
      0.42,
      ["deterministic_fallback"],
      "Fallback candidate created because no fine-grained moment signal was available.",
      options,
    );
  }
}

function dedupeAndRank(
  candidates: AtlasMomentCandidate[],
  options: Required<AtlasMomentEngineOptions>,
): AtlasMomentCandidate[] {
  const unique = new Map<string, AtlasMomentCandidate>();

  for (const candidate of candidates) {
    const key = candidateKey(
      candidate.sourceFilename,
      candidate.type,
      candidate.start,
      candidate.end,
    );

    const existing = unique.get(key);
    if (!existing || candidate.score > existing.score) {
      unique.set(key, candidate);
    }
  }

  return [...unique.values()]
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, options.maxCandidatesPerSource)
    .map((candidate, index) => ({
      ...candidate,
      id: `${candidate.sourceFilename.replace(/[^a-zA-Z0-9_-]+/g, "_")}-m${index + 1}`,
    }));
}

export function generateMomentCandidates(
  analysis: AtlasMomentAnalysis,
  optionsInput: AtlasMomentEngineOptions = {},
): AtlasMomentCandidate[] {
  const options = {
    ...DEFAULTS,
    ...optionsInput,
  };

  const filename = cleanString(analysis.filename);
  const duration = Math.max(0, finite(analysis.duration, 0));

  if (!filename || duration <= 0) return [];

  const normalizedAnalysis: AtlasMomentAnalysis = {
    ...analysis,
    filename,
    duration,
  };

  const candidates: AtlasMomentCandidate[] = [];

  ingestExplicitMoments(
    normalizedAnalysis,
    duration,
    candidates,
    options,
  );

  ingestSignalFamily(
    normalizedAnalysis,
    duration,
    candidates,
    "ACTION_PEAK",
    analysis.action_peaks,
    options,
  );

  ingestSignalFamily(
    normalizedAnalysis,
    duration,
    candidates,
    "MOTION_PEAK",
    analysis.motion_peaks,
    options,
  );

  ingestSignalFamily(
    normalizedAnalysis,
    duration,
    candidates,
    "REVEAL",
    analysis.reveals,
    options,
  );

  ingestSignalFamily(
    normalizedAnalysis,
    duration,
    candidates,
    "HERO_FRAME",
    analysis.hero_frames,
    options,
  );

  ingestSignalFamily(
    normalizedAnalysis,
    duration,
    candidates,
    "REACTION",
    analysis.reactions,
    options,
  );

  ingestSignalFamily(
    normalizedAnalysis,
    duration,
    candidates,
    "TRANSFORMATION",
    analysis.transformations,
    options,
  );

  addSuggestedWindow(
    normalizedAnalysis,
    duration,
    candidates,
    options,
  );

  /*
   * Vision often has only coarse clip-level data today. In that case,
   * deterministic anchors give the Edit Director usable source windows
   * without pretending we performed frame-level semantic analysis.
   */
  if (candidates.length === 0) {
    addFallbackWindows(
      normalizedAnalysis,
      duration,
      candidates,
      options,
    );
  }

  const ranked = dedupeAndRank(candidates, options);

  if (ranked.length > 0) return ranked;

  /*
   * Last-resort candidate for short/odd media. This never invents time
   * outside the actual source.
   */
  return [
    {
      id: `${filename.replace(/[^a-zA-Z0-9_-]+/g, "_")}-m1`,
      sourceFilename: filename,
      type: "BEST_WINDOW",
      start: 0,
      end: Number(duration.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      score: clamp(finite(analysis.score, 50) / 100, 0, 1),
      confidence: 0.25,
      beatFit: beatFitForType("BEST_WINDOW"),
      signals: ["full_source_fallback"],
      rationale: "The source is shorter than the normal candidate window; the complete usable source is retained.",
    },
  ];
}

export function generateMomentCandidatesForSources(
  analyses: AtlasMomentAnalysis[],
  options: AtlasMomentEngineOptions = {},
): AtlasMomentCandidate[] {
  return analyses.flatMap((analysis) =>
    generateMomentCandidates(analysis, options),
  );
}

export function selectBestMomentForIntent(
  candidates: AtlasMomentCandidate[],
  intent: AtlasBeatIntent,
): AtlasMomentCandidate | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  return [...candidates]
    .sort((a, b) => {
      const aFit = roleCompatibility(a.type, intent);
      const bFit = roleCompatibility(b.type, intent);

      const aScore = a.score * 0.7 + aFit * 0.2 + a.confidence * 0.1;
      const bScore = b.score * 0.7 + bFit * 0.2 + b.confidence * 0.1;

      return bScore - aScore || a.start - b.start;
    })[0] ?? null;
}

/**
 * Converts a selected moment into the V2 sourceMoment payload.
 * This is deliberately adapter-only: it does not make a new creative decision.
 */
export function momentToSourceMoment(
  moment: AtlasMomentCandidate,
): {
  type: string;
  start: number;
  end: number;
  score: number;
} {
  return {
    type: moment.type,
    start: moment.start,
    end: moment.end,
    score: Number((moment.score * 100).toFixed(1)),
  };
}

/**
 * Small utility for callers that need source durations before generation.
 */
export function toAtlasSourceAssets(
  analyses: AtlasMomentAnalysis[],
): AtlasSourceAsset[] {
  return analyses
    .map((analysis) => ({
      filename: cleanString(analysis.filename),
      duration: Math.max(0, finite(analysis.duration, 0)),
    }))
    .filter(
      (source) => Boolean(source.filename) && source.duration > 0,
    );
}
