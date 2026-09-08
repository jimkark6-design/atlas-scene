/*
 * ATLAS Transition Intelligence V6
 *
 * Edge-first editorial treatment. Every A->B edge is evaluated. A clean cut is
 * still a valid treatment, but the engine is deliberately willing to use
 * motivated transitions on most edges when the footage supports them.
 *
 * Priority: motivated transition > generic effect; clean cut > bad transition.
 */

export type TransitionKind = "CUT" | "MATCH" | "WHIP" | "ZOOM" | "PUNCH" | "FLASH" | "FADE";

type EdgeCandidate = {
  index: number;
  type: TransitionKind;
  score: number;
  reason: string;
  direction?: string;
  duration: number;
};

const MAX_TREATED_EDGES = 6;
const MIN_TREATMENT_SCORE = 56;

const num = (v: any, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const text = (v: any) => String(v || "").trim().toUpperCase();

const motionVector = (motion: string) => {
  switch (text(motion)) {
    case "PAN_LEFT": return [-1, 0, 0];
    case "PAN_RIGHT": return [1, 0, 0];
    case "TILT_UP": return [0, -1, 0];
    case "TILT_DOWN": return [0, 1, 0];
    case "PUSH_IN": return [0, 0, 1];
    case "PULL_OUT": return [0, 0, -1];
    case "HANDHELD": return [0.35, 0.2, 0];
    case "DRIFT": return [0.25, -0.1, 0.08];
    default: return [0, 0, 0];
  }
};

const magnitude = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] || 0), 0);

const sourceType = (shot: any, analysis?: any) => text(
  analysis?.shot_type || analysis?.shotType || analysis?.framing || analysis?.composition ||
  shot?.shot_type || shot?.shotType || shot?.framing || shot?.composition,
);

const momentType = (shot: any) => text(shot?.source_moment?.type);
const intent = (shot: any) => text(shot?.beat_intent || shot?.role);

function energyScore(shot: any) {
  const m = momentType(shot);
  const cut = text(shot?.cut_on);
  const motion = text(shot?.motion);
  let score = 0;
  if (["ACTION_PEAK", "MOTION_PEAK", "REVEAL", "TRANSFORMATION"].includes(m)) score += 34;
  if (["ACTION", "MOTION", "IMPACT", "REVEAL", "BEAT"].includes(cut)) score += 18;
  if (["ACTION", "ESCALATION", "TRANSFORMATION", "HOOK_IMPACT", "HERO"].includes(intent(shot))) score += 16;
  if (motion !== "STATIC") score += 12;
  return Math.min(100, score);
}

function compositionScore(a: any, b: any, typeA: string, typeB: string) {
  let score = 0;
  const productA = /PRODUCT|DETAIL|CLOSE|HERO|FOOD|MACRO/.test(typeA);
  const productB = /PRODUCT|DETAIL|CLOSE|HERO|FOOD|MACRO/.test(typeB);
  if (productA || productB) score += 12;
  if (productA && productB) score += 18;
  if (typeA && typeA === typeB) score += 10;
  if (Math.abs(num(a?.zoom_end, 1) - num(b?.zoom_start, 1)) < 0.12) score += 7;
  return score;
}

function candidateSet(a: any, b: any, analysisA?: any, analysisB?: any): EdgeCandidate[] {
  const ma = text(a?.motion);
  const mb = text(b?.motion);
  const va = motionVector(ma);
  const vb = motionVector(mb);
  const magA = magnitude(va);
  const magB = magnitude(vb);
  const sameSource = text(a?.source_filename) === text(b?.source_filename);
  const typeA = sourceType(a, analysisA);
  const typeB = sourceType(b, analysisB);
  const intentB = intent(b);
  const energy = Math.min(100, energyScore(a) * 0.55 + energyScore(b) * 0.85);
  const comp = compositionScore(a, b, typeA, typeB);
  const sameDirection = dot(va, vb) > 0.08;
  const directionalPair = magA + magB >= 0.55;
  const actionEdge = energyScore(a) + energyScore(b) >= 34;
  const heroB = ["HERO", "PAYOFF", "TRANSFORMATION", "PROOF"].includes(intentB);
  const out: EdgeCandidate[] = [];
  const add = (type: TransitionKind, score: number, reason: string, direction = "", duration = 0.16) => {
    out.push({ index: -1, type, score: Math.min(99, score), reason, direction, duration });
  };

  // Directional motion: reward relative motion, not just absolute action peaks.
  if (!sameSource && directionalPair) {
    let score = 50 + Math.min(22, (magA + magB) * 9) + (sameDirection ? 13 : 4);
    if (ma === mb && ma !== "STATIC") score += 10;
    if (["PAN_LEFT", "PAN_RIGHT"].includes(ma) && ["PAN_LEFT", "PAN_RIGHT"].includes(mb)) score += 9;
    if (actionEdge) score += 5;
    if (score >= MIN_TREATMENT_SCORE) {
      const dir = (va[0] + vb[0]) >= 0 ? "RIGHT" : "LEFT";
      add("WHIP", score, `motivated directional handoff ${ma}→${mb}`, dir, 0.18);
    }
  }

  // Zoom continuity: especially useful for push/pull into a product or payoff.
  if (!sameSource && (["PUSH_IN", "PULL_OUT"].includes(ma) || ["PUSH_IN", "PULL_OUT"].includes(mb))) {
    let score = 53 + comp * 0.45 + energy * 0.20;
    if (ma === mb) score += 10;
    if (heroB) score += 9;
    if (score >= MIN_TREATMENT_SCORE) {
      add("ZOOM", score, `scale-driven handoff ${ma}→${mb}`, ma === "PULL_OUT" ? "OUT" : "IN", 0.16);
    }
  }

  // Match treatment: composition/scale/food-product continuity.
  if (!sameSource && comp >= 18) {
    let score = 55 + comp * 0.75;
    if (heroB) score += 7;
    if (actionEdge) score += 4;
    add("MATCH", score, `composition/scale continuity ${typeA}→${typeB}`, "", 0.16);
  }

  // Punch: an energetic bridge into payoff/hero/detail. Less flashy than flash.
  if (!sameSource && (heroB || /DETAIL|HERO|CLOSE|FOOD|PRODUCT/.test(typeB)) && (energy >= 28 || actionEdge)) {
    let score = 57 + energy * 0.42 + comp * 0.18;
    if (heroB) score += 8;
    add("PUNCH", score, "energy release into hero/product payoff", "IN", 0.17);
  }

  // Flash is reserved for genuine impact, never as the default treatment.
  if (!sameSource && energy >= 70 && ["HOOK_IMPACT", "ESCALATION", "TRANSFORMATION"].includes(intentB)) {
    add("FLASH", 72 + energy * 0.20, "high-energy impact bridge", "", 0.10);
  }

  // Always retain clean cut as a candidate.
  add("CUT", 58, "clean editorial cut fallback", "", 0);
  return out.sort((x, y) => y.score - x.score);
}

/**
 * Evaluate every final A→B edge. Most edges may receive treatment; selection
 * only limits repetition and protects against weak/gimmicky effects.
 */
export function repairTransitionIntelligence(timeline: any[], analyses: any[] = []) {
  const shots = Array.isArray(timeline) ? timeline.map((x) => ({ ...x })) : [];
  const byName = new Map((analyses || []).map((x: any) => [String(x.filename), x]));
  const edgeOptions: EdgeCandidate[][] = [];

  for (let i = 1; i < shots.length; i++) {
    edgeOptions.push(candidateSet(
      shots[i - 1], shots[i],
      byName.get(String(shots[i - 1]?.source_filename)),
      byName.get(String(shots[i]?.source_filename)),
    ).map(c => ({ ...c, index: i })));
  }

  const selected: EdgeCandidate[] = [];
  const usedTypes = new Map<string, number>();

  // First pass: best treatment per edge, but allow adjacent edges. We only
  // suppress an effect when it repeats too many times in a row.
  for (let e = 0; e < edgeOptions.length && selected.length < MAX_TREATED_EDGES; e++) {
    const options = edgeOptions[e];
    const viable = options.filter(c => c.type !== "CUT" && c.score >= MIN_TREATMENT_SCORE);
    if (!viable.length) continue;

    let pick = viable[0];
    // Prefer a different effect if the same type was already used twice.
    if ((usedTypes.get(pick.type) || 0) >= 2) {
      pick = viable.find(c => c.type !== pick.type) || pick;
    }
    selected.push(pick);
    usedTypes.set(pick.type, (usedTypes.get(pick.type) || 0) + 1);
  }

  // Second pass: if the footage is motion-rich, fill one or two remaining
  // edges with the next-best distinct treatment rather than forcing cuts.
  if (selected.length < 4) {
    for (let e = 0; e < edgeOptions.length && selected.length < Math.min(5, MAX_TREATED_EDGES); e++) {
      if (selected.some(s => s.index === e + 1)) continue;
      const alt = edgeOptions[e].find(c => c.type !== "CUT" && c.score >= MIN_TREATMENT_SCORE - 4 && (usedTypes.get(c.type) || 0) < 3);
      if (!alt) continue;
      selected.push(alt);
      usedTypes.set(alt.type, (usedTypes.get(alt.type) || 0) + 1);
    }
  }

  selected.sort((a, b) => a.index - b.index);

  for (const shot of shots) {
    shot.transition_in = "CUT";
    shot.transition_out = "CUT";
    delete shot.transition_reason;
    delete shot.transition_score;
    delete shot.transition_direction;
    delete shot.transition_duration;
  }

  for (const edge of selected) {
    const prev = shots[edge.index - 1];
    const next = shots[edge.index];
    if (!prev || !next) continue;
    prev.transition_out = edge.type;
    next.transition_in = edge.type;
    next.transition_reason = edge.reason;
    next.transition_score = Number(edge.score.toFixed(1));
    next.transition_direction = edge.direction || undefined;
    next.transition_duration = edge.duration;
  }

  console.log(
    `[ATLAS TRANSITION INTELLIGENCE V6] edges=${edgeOptions.length} selected=${selected.length} | ` +
    (selected.length
      ? selected.map(e => `${e.index - 1}->${e.index}:${e.type}@${e.score.toFixed(0)}${e.direction ? `:${e.direction}` : ""}/${e.duration.toFixed(2)}s`).join(" | ")
      : "clean cuts only"),
  );

  return shots;
}
