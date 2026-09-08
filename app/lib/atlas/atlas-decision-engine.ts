import type { AtlasBeatIntent } from "./atlas-edit-contract";
import type { AtlasMomentCandidate } from "./atlas-moment-engine";

type RawBeat = Record<string, any>;

export type AtlasDecisionEngineOptions = {
  beamWidth?: number;
  candidatesPerBeat?: number;
  maxSourceReuse?: number;
};

export type AtlasEditCandidate = {
  id: string;
  timeline: RawBeat[];
  score: number;
  uniqueSources: number;
  totalDuration: number;
  rationale: string[];
};

const DEFAULTS: Required<AtlasDecisionEngineOptions> = {
  beamWidth: 8,
  candidatesPerBeat: 5,
  maxSourceReuse: 2,
};

const INTENTS = new Set<AtlasBeatIntent>([
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
]);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function intentOf(beat: RawBeat, index: number): AtlasBeatIntent {
  const raw = String(beat?.beat_intent || "").trim().toUpperCase();
  if (INTENTS.has(raw as AtlasBeatIntent)) return raw as AtlasBeatIntent;
  const role = String(beat?.role || "STORY").toUpperCase();
  if (role === "HOOK") return "HOOK_IMPACT";
  if (role === "PAYOFF") return "PAYOFF" as AtlasBeatIntent;
  if (role === "CTA") return "CTA";
  return index === 0 ? "HOOK_IMPACT" : "ACTION";
}

function candidateFit(candidate: AtlasMomentCandidate, intent: AtlasBeatIntent) {
  const fit = candidate.beatFit.includes(intent) ? 1 : 0.45;
  const typeBoost =
    (intent === "HOOK_IMPACT" && ["ACTION_PEAK", "MOTION_PEAK", "DETAIL"].includes(candidate.type)) ||
    (intent === "PROBLEM" && ["DETAIL", "ESTABLISH", "REACTION"].includes(candidate.type)) ||
    (intent === "ACTION" && ["ACTION_PEAK", "MOTION_PEAK", "DETAIL"].includes(candidate.type)) ||
    (intent === "PROOF" && ["DETAIL", "REACTION", "REVEAL"].includes(candidate.type)) ||
    (intent === "ESCALATION" && ["ACTION_PEAK", "MOTION_PEAK", "TRANSFORMATION"].includes(candidate.type)) ||
    (intent === "TRANSFORMATION" && ["TRANSFORMATION", "REVEAL", "HERO_FRAME"].includes(candidate.type)) ||
    (intent === "HERO" && ["HERO_FRAME", "REVEAL", "TRANSFORMATION"].includes(candidate.type)) ||
    (intent === "CTA" && ["HERO_FRAME", "REVEAL", "TRANSFORMATION"].includes(candidate.type)) ||
    (intent === "REACTION" && candidate.type === "REACTION") ||
    (intent === "BRIDGE" && ["ESTABLISH", "BREATH", "BEST_WINDOW"].includes(candidate.type)) ||
    (intent === "BREATH" && ["BREATH", "HERO_FRAME", "BEST_WINDOW"].includes(candidate.type));

  return clamp(fit * 0.55 + (typeBoost ? 0.45 : 0), 0, 1);
}

function roleDurationTarget(role: string) {
  switch (role.toUpperCase()) {
    case "HOOK": return [0.8, 1.5];
    case "PAYOFF": return [1.5, 2.8];
    case "CTA": return [2.0, 3.0];
    default: return [0.65, 1.9];
  }
}

function durationScore(duration: number, role: string) {
  const [min, max] = roleDurationTarget(role);
  if (duration >= min && duration <= max) return 1;
  const distance = duration < min ? min - duration : duration - max;
  return clamp(1 - distance / 1.5, 0, 1);
}

function transitionPenalty(previous: RawBeat | undefined, current: RawBeat) {
  if (!previous) return 0;
  const sameSource = String(previous.source_filename || "") === String(current.source_filename || "");
  const sameIntent = String(previous.beat_intent || "") === String(current.beat_intent || "");
  const sameMotion = String(previous.motion || "STATIC") === String(current.motion || "STATIC");
  if (sameSource && sameIntent && sameMotion) return 0.7;
  if (sameSource && sameIntent) return 0.35;
  if (sameSource) return 0.12;
  return 0;
}

function stableCandidateId(beatIndex: number, candidate: AtlasMomentCandidate) {
  return `${String(candidate.id)}@beat-${beatIndex + 1}`;
}

export function searchBestEditCandidate(
  rawTimeline: RawBeat[],
  candidates: AtlasMomentCandidate[],
  targetDuration: number,
  optionsInput: AtlasDecisionEngineOptions = {},
): AtlasEditCandidate {
  const options = { ...DEFAULTS, ...optionsInput };
  const usable = Array.isArray(rawTimeline) ? rawTimeline : [];
  if (!usable.length || !candidates.length) {
    return {
      id: "decision-pass-through",
      timeline: usable,
      score: 0,
      uniqueSources: new Set(usable.map((b) => String(b?.source_filename || "")).filter(Boolean)).size,
      totalDuration: usable.reduce((sum, b) => sum + Math.max(0, Number(b?.source_end || 0) - Number(b?.source_start || 0)), 0),
      rationale: ["No candidate-search inputs were available; preserved the AI timeline."],
    };
  }

  type Beam = {
    timeline: RawBeat[];
    score: number;
    sourceCounts: Map<string, number>;
    rationale: string[];
  };

  let beams: Beam[] = [{ timeline: [], score: 0, sourceCounts: new Map(), rationale: [] }];

  for (let i = 0; i < usable.length; i++) {
    const beat = usable[i];
    const intent = intentOf(beat, i);

    const ranked = candidates
      .map((candidate) => ({
        candidate,
        score:
          candidate.score * 0.45 +
          candidate.confidence * 0.10 +
          candidateFit(candidate, intent) * 0.45,
      }))
      .sort((a, b) => b.score - a.score || a.candidate.start - b.candidate.start)
      .slice(0, options.candidatesPerBeat);

    const next: Beam[] = [];

    for (const beam of beams) {
      for (const { candidate, score } of ranked) {
        const source = candidate.sourceFilename;
        const sourceCount = beam.sourceCounts.get(source) || 0;
        if (sourceCount >= options.maxSourceReuse && i < usable.length - 1) continue;

        const duration = Math.max(0.25, candidate.duration);
        const roleScore = durationScore(duration, String(beat?.role || "STORY"));
        const penalty = transitionPenalty(beam.timeline[beam.timeline.length - 1], {
          ...beat,
          source_filename: source,
          beat_intent: intent,
          motion: beat?.motion,
        });

        const selected = {
          ...beat,
          source_filename: source,
          source_start: candidate.start,
          source_end: candidate.end,
          moment_candidate_id: candidate.id,
          beat_intent: intent,
          source_moment: {
            type: candidate.type,
            start: candidate.start,
            end: candidate.end,
            score: Number((candidate.score * 100).toFixed(1)),
          },
        };

        const updatedCounts = new Map(beam.sourceCounts);
        updatedCounts.set(source, sourceCount + 1);

        next.push({
          timeline: [...beam.timeline, selected],
          score: beam.score + score + roleScore * 0.20 - penalty,
          sourceCounts: updatedCounts,
          rationale: [
            ...beam.rationale,
            `${String(beat?.id || `beat-${i + 1}`)}: ${candidate.type} ${candidate.start.toFixed(2)}-${candidate.end.toFixed(2)} (${source})`,
          ],
        });
      }
    }

    next.sort((a, b) => b.score - a.score);
    beams = next.slice(0, options.beamWidth);
    if (!beams.length) break;
  }

  const evaluated = beams.map((beam, index) => {
    const timeline = beam.timeline;
    const uniqueSources = new Set(
      timeline.map((beat) => String(beat?.source_filename || "")).filter(Boolean),
    ).size;
    const totalDuration = timeline.reduce(
      (sum, beat) => sum + Math.max(0, Number(beat?.source_end || 0) - Number(beat?.source_start || 0)),
      0,
    );

    const target = clamp(Number(targetDuration) || 15, 8, 60);
    const durationPenalty = Math.abs(totalDuration - target) / Math.max(1, target);
    const sourceBonus = uniqueSources / Math.max(1, Math.min(7, timeline.length));
    const ctaOk = String(timeline[timeline.length - 1]?.role || "").toUpperCase() === "CTA" ? 1 : 0;

    const finalScore = beam.score + sourceBonus * 1.5 + ctaOk * 1.0 - durationPenalty * 2;

    return {
      ...beam,
      uniqueSources,
      totalDuration,
      finalScore,
      rank: index,
    };
  });

  evaluated.sort((a, b) => b.finalScore - a.finalScore || b.uniqueSources - a.uniqueSources);
  const best = evaluated[0];

  if (!best) {
    return {
      id: "decision-empty",
      timeline: usable,
      score: 0,
      uniqueSources: 0,
      totalDuration: 0,
      rationale: ["Candidate search produced no valid beam; preserved the AI timeline."],
    };
  }

  return {
    id: `edit-candidate-${Date.now().toString(36)}`,
    timeline: best.timeline,
    score: Number(best.finalScore.toFixed(4)),
    uniqueSources: best.uniqueSources,
    totalDuration: Number(best.totalDuration.toFixed(3)),
    rationale: best.rationale,
  };
}
