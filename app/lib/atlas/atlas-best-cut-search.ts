import type { AtlasBeatIntent } from "./atlas-edit-contract";

export type AtlasBestCutCandidate = {
  id: string;
  timeline: any[];
  score: number;
  breakdown: {
    coverage: number;
    intentFit: number;
    sourceDiversity: number;
    rhythm: number;
    variety: number;
    transitionDiscipline: number;
    textDiscipline: number;
    ctaIntegrity: number;
    durationFit: number;
  };
  rationale: string[];
};

export type AtlasBestCutSearchOptions = {
  maxCandidates?: number;
  targetDuration?: number;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const ROLE_RANGES: Record<string, [number, number]> = {
  HOOK: [0.8, 1.5],
  STORY: [0.65, 1.9],
  PAYOFF: [1.5, 2.8],
  CTA: [2.0, 3.0],
};

const INTENTS = new Set<AtlasBeatIntent>([
  "HOOK_IMPACT", "PROBLEM", "ACTION", "PROOF", "ESCALATION",
  "TRANSFORMATION", "HERO", "CTA", "REACTION", "BRIDGE", "BREATH",
]);

function intentOf(beat: any, index: number): AtlasBeatIntent {
  const raw = String(beat?.beat_intent || "").trim().toUpperCase();
  if (INTENTS.has(raw as AtlasBeatIntent)) return raw as AtlasBeatIntent;
  const role = String(beat?.role || "STORY").toUpperCase();
  if (role === "HOOK") return "HOOK_IMPACT";
  if (role === "PAYOFF") return "HERO";
  if (role === "CTA") return "CTA";
  return index === 0 ? "HOOK_IMPACT" : "ACTION";
}

function durationFit(beat: any): number {
  const role = String(beat?.role || "STORY").toUpperCase();
  const [min, max] = ROLE_RANGES[role] || ROLE_RANGES.STORY;
  const d = Math.max(0, Number(beat?.source_end || 0) - Number(beat?.source_start || 0));
  if (d >= min && d <= max) return 1;
  const dist = d < min ? min - d : d - max;
  return clamp(1 - dist / 1.5, 0, 1);
}

function cutMotivation(beat: any): number {
  const cutOn = String(beat?.cut_on || "").toUpperCase();
  return ["ACTION_PEAK", "MOTION_MATCH", "WORD_EMPHASIS", "MUSIC_BEAT", "REVEAL", "BREATH"].includes(cutOn) ? 1 : 0.35;
}

function adjacentPenalty(a: any, b: any): number {
  if (!a || !b) return 0;
  let p = 0;
  if (String(a.source_filename) === String(b.source_filename)) p += 0.55;
  if (String(a.motion || "STATIC") === String(b.motion || "STATIC")) p += 0.15;
  if (String(a.beat_intent || "") === String(b.beat_intent || "")) p += 0.1;
  if (String(a.cut_on || "") === "NONE" && String(b.cut_on || "") === "NONE") p += 0.1;
  return p;
}

function scoreCandidate(timeline: any[], targetDuration: number): AtlasBestCutCandidate {
  const beats = timeline || [];
  const total = beats.reduce((s, b) => s + Math.max(0, Number(b?.source_end || 0) - Number(b?.source_start || 0)), 0);
  const target = clamp(Number(targetDuration) || 15, 8, 60);

  const coverage = beats.length >= 7 ? 1 : clamp(beats.length / 7, 0, 1);
  const intentFit = beats.length ? beats.reduce((s, b, i) => {
    const intent = intentOf(b, i);
    const raw = String(b?.beat_intent || "").toUpperCase();
    return s + (raw === intent ? 1 : raw ? 0.55 : 0.35);
  }, 0) / beats.length : 0;

  const uniqueSources = new Set(beats.map(b => String(b?.source_filename || "")).filter(Boolean)).size;
  const diversityTarget = Math.min(7, beats.length);
  const sourceDiversity = diversityTarget ? clamp(uniqueSources / diversityTarget, 0, 1) : 0;

  const rhythm = beats.length ? beats.reduce((s, b) => s + durationFit(b) * 0.7 + cutMotivation(b) * 0.3, 0) / beats.length : 0;

  const variety = beats.length > 1
    ? clamp(1 - beats.slice(1).reduce((s, b, i) => s + adjacentPenalty(beats[i], b), 0) / ((beats.length - 1) * 0.9), 0, 1)
    : 0;

  const nonCuts = beats.filter(b => {
    const t = String(b?.transition_in || "CUT").toUpperCase();
    return t !== "CUT" && t !== "NONE";
  }).length;
  const transitionDiscipline = clamp(1 - Math.max(0, nonCuts - 2) / 4, 0, 1);

  const textBeats = beats.filter(b => String(b?.text || "").trim()).length;
  const textDiscipline = textBeats <= 3 ? 1 : clamp(1 - (textBeats - 3) / 4, 0, 1);

  const ctaCount = beats.filter(b => String(b?.role || "").toUpperCase() === "CTA").length;
  const ctaIntegrity = ctaCount === 1 && String(beats[beats.length - 1]?.role || "").toUpperCase() === "CTA" ? 1 : 0;

  const durationFitScore = clamp(1 - Math.abs(total - target) / Math.max(1, target), 0, 1);

  const score =
    coverage * 10 +
    intentFit * 15 +
    sourceDiversity * 15 +
    rhythm * 15 +
    variety * 12 +
    transitionDiscipline * 8 +
    textDiscipline * 5 +
    ctaIntegrity * 10 +
    durationFitScore * 10;

  const rationale = [
    `coverage=${coverage.toFixed(2)}`,
    `intentFit=${intentFit.toFixed(2)}`,
    `sourceDiversity=${uniqueSources}/${diversityTarget}`,
    `rhythm=${rhythm.toFixed(2)}`,
    `variety=${variety.toFixed(2)}`,
    `duration=${total.toFixed(2)}s/${target.toFixed(2)}s`,
  ];

  return {
    id: `best-cut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    timeline: beats,
    score: Number(score.toFixed(4)),
    breakdown: { coverage, intentFit, sourceDiversity, rhythm, variety, transitionDiscipline, textDiscipline, ctaIntegrity, durationFit: durationFitScore },
    rationale,
  };
}

export function searchBestCut(
  candidates: any[][],
  options: AtlasBestCutSearchOptions = {},
): AtlasBestCutCandidate {
  const list = (candidates || []).slice(0, options.maxCandidates ?? 5);
  if (!list.length) {
    return scoreCandidate([], options.targetDuration ?? 15);
  }

  return list
    .map(timeline => scoreCandidate(timeline, options.targetDuration ?? 15))
    .sort((a, b) => b.score - a.score)[0];
}
