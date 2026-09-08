import OpenAI from "openai";
import { NextResponse } from "next/server";
import {
  assertExecutableTimeline,
  deriveSfxEvents,
  normalizeMusicCurve,
  normalizeSpeedCurve,
  type AtlasEditPlanV2,
  type AtlasSourceAsset,
  type AtlasBeatIntent,
} from "../../lib/atlas/atlas-edit-contract";
import {
  generateMomentCandidatesForSources,
  selectBestMomentForIntent,
  momentToSourceMoment,
  type AtlasMomentCandidate,
} from "../../lib/atlas/atlas-moment-engine";
import {
  searchBestEditCandidate,
  type AtlasEditCandidate,
} from "../../lib/atlas/atlas-decision-engine";
import {
  searchBestCut,
  type AtlasBestCutCandidate,
} from "../../lib/atlas/atlas-best-cut-search";
import { repairTransitionIntelligence } from "../../lib/atlas/atlas-transition-engine";

export const runtime = "nodejs";

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

const TRANSITIONS = [
  "CUT", "FADE", "WHIP", "MATCH", "ZOOM", "PUNCH",
  "SLIDE_LEFT", "SLIDE_RIGHT", "SLIDE_UP", "SLIDE_DOWN", "FLASH", "NONE",
] as const;

const MOTIONS = [
  "STATIC", "PUSH_IN", "PULL_OUT", "PAN_LEFT", "PAN_RIGHT",
  "TILT_UP", "TILT_DOWN", "HANDHELD", "DRIFT",
] as const;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    version: { type: "string" },
    editorial_intent: { type: "string" },
    hook_strategy: { type: "string" },
    music_strategy: { type: "string" },
    timeline: {
      type: "array",
      minItems: 7,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          source_filename: { type: "string" },
          source_start: { type: "number" },
          source_end: { type: "number" },
          moment_candidate_id: { type: "string" },
          role: { type: "string", enum: ["HOOK", "STORY", "PAYOFF", "CTA"] },
          purpose: { type: "string" },
          cut_reason: { type: "string" },
          transition_in: { type: "string", enum: [...TRANSITIONS] },
          transition_out: { type: "string", enum: [...TRANSITIONS] },
          motion: { type: "string", enum: [...MOTIONS] },
          zoom_start: { type: "number" },
          zoom_end: { type: "number" },
          speed: { type: "number" },
          text: { type: "string" },
          text_style: { type: "string", enum: ["NONE","HOOK","KINETIC","EMPHASIS","MINIMAL","PRICE","CTA","CAPTION"] },
          text_animation: { type: "string", enum: ["NONE","POP","WORD_POP","SLIDE_UP","SLIDE_LEFT","SLIDE_RIGHT","FADE","SCALE"] },
          text_position: { type: "string", enum: ["TOP","CENTER","BOTTOM","LOWER_THIRD"] },
          emphasis_words: { type: "array", items: { type: "string" } },
          sfx: { type: "array", items: { type: "string" } },
          sfx_events: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string" },
                at: { type: "number" },
                volume: { type: "number" },
              },
              required: ["type", "at", "volume"],
            },
          },
          source_audio_volume: { type: "number" },
          music_volume: { type: "number" },
          color_treatment: { type: "string" },
          crop_focus: {
            type: "string",
            enum: ["CENTER","FACE","PRODUCT","ACTION","TOP","BOTTOM","LEFT","RIGHT"],
          },
          editorial_score: { type: "number" },
          beat_intent: { type: "string", enum: ["HOOK_IMPACT","PROBLEM","ACTION","PROOF","ESCALATION","TRANSFORMATION","HERO","CTA"] },
          cut_on: { type: "string", enum: ["ACTION_PEAK","MOTION_MATCH","WORD_EMPHASIS","MUSIC_BEAT","REVEAL","BREATH","NONE"] },
        },
        required: [
          "id","source_filename","source_start","source_end","moment_candidate_id","role","purpose",
          "cut_reason","transition_in","transition_out","motion","zoom_start",
          "zoom_end","speed","text","text_style","text_animation","text_position",
          "emphasis_words","sfx","sfx_events","source_audio_volume","music_volume",
          "color_treatment","crop_focus","editorial_score","beat_intent","cut_on",
        ],
      },
    },
  },
  required: ["version","editorial_intent","hook_strategy","music_strategy","timeline"],
} as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function cleanTransition(value: any) {
  const v = String(value || "CUT").toUpperCase();
  return (TRANSITIONS as readonly string[]).includes(v) ? v : "CUT";
}


/**
 * Commercial visual classifier V21.
 *
 * Do not classify a clip as HERO just because Vision text contains words such
 * as "hero", "premium" or "dish". Active preparation must beat generic hero
 * language. The classifier is intentionally evidence-weighted so an active
 * chef/knife/torch clip cannot become the CTA merely because it was described
 * as a "hero shot" upstream.
 */
function classifyCommercialVisual(source: any) {
  const values = [
    source?.shot_type, source?.shotType, source?.recommended_use,
    source?.reason, source?.strengths, source?.problems, source?.description,
    source?.summary, source?.subject, source?.action, source?.composition,
  ];
  const text = values
    .flatMap((v: any) => Array.isArray(v) ? v : [v])
    .map((v: any) => String(v || "").toLowerCase())
    .join(" ");

  const hit = (pattern: RegExp) => (text.match(pattern) || []).length;

  const action =
    hit(/\b(torch|flame|fire|blowtorch|torching)\b/g) * 8 +
    hit(/\b(knife|cutting|slice|slicing|chopping)\b/g) * 7 +
    hit(/\b(rolling|roll|shaping|assembling|placing|plating|garnish|prep|preparing|cooking|cook|process|craft|making)\b/g) * 5 +
    hit(/\b(chef|hands?|gloves?)\b/g) * 3;

  const human =
    hit(/\b(customer|guest|people|person|woman|man|eating|bite|mouth|face|dining|reaction|lifestyle)\b/g) * 8 +
    hit(/\b(chopsticks?)\b/g) * 3;

  const hero =
    hit(/\b(plated|finished|final dish|dish reveal|food showcase|menu hero|beauty shot|signature dish|served|presentation|completed dish)\b/g) * 10 +
    hit(/\b(plate|platter|spread)\b/g) * 4 +
    // "hero" / "premium" alone are weak evidence because upstream Vision
    // often uses them for non-hero action footage.
    hit(/\b(hero|premium)\b/g) * 1;

  const detail =
    hit(/\b(salmon|fish|rice|ingredient|texture|macro|detail|close[- ]?up|sauce|sushi close)\b/g) * 7 +
    hit(/\b(food|sushi|dish)\b/g) * 2;

  const context =
    hit(/\b(overhead|top[- ]?down|wide|establish|environment|interior|exterior|restaurant|context|room|table)\b/g) * 4;

  // Strong active-motion evidence overrides generic hero language.
  let family: string;
  if (human >= Math.max(8, action + 2) && human >= hero + 4) {
    family = "HUMAN";
  } else if (hero >= 12 && hero >= action + 6 && human < 8) {
    family = "HERO";
  } else if (action >= Math.max(8, hero + 2)) {
    family = "ACTION";
  } else if (detail >= Math.max(7, hero + 1) && action < 8) {
    family = "DETAIL";
  } else if (context >= 8 && action < 8 && hero < 12) {
    family = "CONTEXT";
  } else if (hero >= 8 && hero >= action + 2 && human < 8) {
    family = "HERO";
  } else if (human >= 8) {
    family = "HUMAN";
  } else if (action >= 5) {
    family = "ACTION";
  } else if (detail >= 5) {
    family = "DETAIL";
  } else if (context >= 4) {
    family = "CONTEXT";
  } else {
    family = "OTHER";
  }

  return { family, action, human, hero, detail, context, text };
}

function commercialVisualFamily(source: any) {
  return classifyCommercialVisual(source).family;
}

function cleanMotion(value: any) {
  const v = String(value || "STATIC").toUpperCase();
  return (MOTIONS as readonly string[]).includes(v) ? v : "STATIC";
}

/**
 * Deterministically repair source adjacency without changing source windows.
 * CTA stays fixed as the final beat. A small DP over the <=11 non-CTA beats
 * finds the lowest-displacement ordering that has no adjacent same-source
 * beats and also avoids creating a CTA/source collision at the end.
 */
function repairAdjacentSourceDuplicates(timeline: any[]) {
  if (timeline.length < 2) return [...timeline];

  const ctaIndex = timeline.findIndex(
    (x) => String(x?.role || "").toUpperCase() === "CTA",
  );
  const cta = ctaIndex >= 0 ? timeline[ctaIndex] : null;

  // Preserve the editorial anchors. We are allowed to reorder middle beats,
  // but never move the HOOK or CTA just to satisfy source diversity.
  const hook = timeline[0];
  const middleStart = 1;
  const middleEnd = ctaIndex >= 0 ? ctaIndex : timeline.length;

  const middle = timeline.slice(middleStart, middleEnd);

  if (middle.length === 0) {
    if (cta && String(hook?.source_filename) === String(cta?.source_filename)) {
      throw new Error("AI Edit Director cannot satisfy HOOK/CTA source separation with the available footage.");
    }
    return cta ? [hook, cta] : [hook];
  }

  const repairedMiddle = repairSequence(
    middle,
    cta ? String(cta.source_filename) : "",
    String(hook?.source_filename || ""),
  );

  const result = [hook, ...repairedMiddle];
  if (cta) result.push(cta);
  return result;
}

function repairSequence(items: any[], blockedFinalSource: string, blockedInitialSource = "") {
  const n = items.length;
  if (n <= 1) {
    if (n === 1 && blockedFinalSource && String(items[0]?.source_filename) === blockedFinalSource) {
      throw new Error("AI Edit Director cannot place a non-CTA beat before CTA without adjacent duplicate source.");
    }
    return [...items];
  }

  const source = items.map((item) => String(item?.source_filename || ""));
  const memo = new Map<string, number>();
  const choice = new Map<string, number>();

  const solve = (mask: number, lastIndex: number, position: number): number => {
    if (position === n) return 0;
    const key = `${mask}|${lastIndex}|${position}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;

    let best = Number.POSITIVE_INFINITY;
    let bestIndex = -1;

    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue;
      if (lastIndex >= 0 && source[i] === source[lastIndex]) continue;
      if (position === 0 && blockedInitialSource && source[i] === blockedInitialSource) continue;
      if (position === n - 1 && blockedFinalSource && source[i] === blockedFinalSource) continue;

      const tail = solve(mask | (1 << i), i, position + 1);
      if (!Number.isFinite(tail)) continue;

      // Minimize displacement from the AI's original order. The tiny
      // tie-breaker keeps earlier source positions preferred.
      const cost = Math.abs(i - position) * 1000 + i + tail;
      if (cost < best) {
        best = cost;
        bestIndex = i;
      }
    }

    memo.set(key, best);
    if (bestIndex >= 0) choice.set(key, bestIndex);
    return best;
  };

  if (!Number.isFinite(solve(0, -1, 0))) {
    throw new Error("AI Edit Director could not deterministically repair adjacent duplicate sources without violating CTA order.");
  }

  const result: any[] = [];
  let mask = 0;
  let lastIndex = -1;

  for (let position = 0; position < n; position++) {
    const key = `${mask}|${lastIndex}|${position}`;
    const index = choice.get(key);
    if (index === undefined) {
      throw new Error("AI Edit Director deterministic source repair produced no valid sequence.");
    }
    result.push(items[index]);
    mask |= 1 << index;
    lastIndex = index;
  }

  return result;
}

function normalizeTimeline(rawTimeline: any[], analyses: any[], targetDuration: number, momentCandidates: AtlasMomentCandidate[] = []) {
  const byName = new Map(analyses.map((x: any) => [String(x.filename), x]));
  const usedWindows = new Set<string>();
  const result: any[] = [];

  for (const item of rawTimeline || []) {
    const src: any = byName.get(String(item?.source_filename || ""));
    if (!src) continue;

    const duration = Number(src.duration) || 0;
    if (duration < 0.25) continue;

    const role = ["HOOK","STORY","PAYOFF","CTA"].includes(String(item.role))
      ? String(item.role)
      : "STORY";
    const intent = mapBeatIntent(item?.beat_intent, role);
    const sourceCandidates = momentCandidates.filter(
      (candidate) => candidate.sourceFilename === String(item.source_filename),
    );
    const requestedMoment = momentCandidates.find(
      (candidate) => candidate.id === String(item?.moment_candidate_id || ""),
    );
    const selectedMoment =
      requestedMoment && requestedMoment.sourceFilename === String(item.source_filename)
        ? requestedMoment
        : selectBestMomentForIntent(sourceCandidates, intent);

    const start = clamp(
      Number(selectedMoment?.start ?? item.source_start) || 0,
      0,
      Math.max(0, duration - 0.20),
    );
    const end = clamp(
      Number(selectedMoment?.end ?? item.source_end) || Math.min(duration, start + 1.2),
      start + 0.25,
      duration,
    );

    const sig = `${item.source_filename}|${start.toFixed(2)}|${end.toFixed(2)}`;
    if (usedWindows.has(sig)) continue;

    usedWindows.add(sig);

    result.push({
      ...item,
      id: String(item.id || `beat-${result.length + 1}`),
      source_filename: String(item.source_filename),
      source_start: Number(start.toFixed(3)),
      source_end: Number(end.toFixed(3)),
      role,
      moment_candidate_id: selectedMoment?.id || String(item?.moment_candidate_id || ""),
      source_moment: selectedMoment
        ? momentToSourceMoment(selectedMoment)
        : item?.source_moment,
      transition_in: cleanTransition(item.transition_in),
      transition_out: cleanTransition(item.transition_out),
      motion: cleanMotion(item.motion),
      zoom_start: clamp(Number(item.zoom_start) || 1, 1, 1.28),
      zoom_end: clamp(Number(item.zoom_end) || 1.04, 1, 1.35),
      speed: clamp(Number(item.speed) || 1, 0.75, 1.35),
      source_audio_volume: clamp(Number(item.source_audio_volume) || 0, 0, 1),
      music_volume: clamp(Number(item.music_volume) || 0.65, 0, 1),
      editorial_score: clamp(Number(item.editorial_score) || 0, 0, 100),
      beat_intent: ["HOOK_IMPACT","PROBLEM","ACTION","PROOF","ESCALATION","TRANSFORMATION","HERO","CTA"].includes(String(item.beat_intent)) ? item.beat_intent : (String(item.role) === "HOOK" ? "HOOK_IMPACT" : String(item.role) === "CTA" ? "CTA" : "ACTION"),
      cut_on: ["ACTION_PEAK","MOTION_MATCH","WORD_EMPHASIS","MUSIC_BEAT","REVEAL","BREATH","NONE"].includes(String(item.cut_on)) ? item.cut_on : "ACTION_PEAK",
      sfx_events: Array.isArray(item.sfx_events)
        ? item.sfx_events.slice(0, 3).map((e: any) => ({
            type: String(e?.type || "NONE"),
            at: Math.max(0, Number(e?.at) || 0),
            volume: clamp(Number(e?.volume) || 0.12, 0, 1),
          }))
        : [],
    });
  }

  // Do not hard-fail on beat count during normalization.
  // 7-10 beats is a quality target for ~15s when footage supports it,
  // but the normalizer must not destroy an otherwise valid edit just because
  // a candidate contains 5-6 strong beats. Higher-level contract checks may
  // request a bounded regeneration when more editorial material is available.

const ctaIndexes = result
  .map((x, index) => ({
    role: String(x.role || "").toUpperCase(),
    index,
  }))
  .filter((x) => x.role === "CTA")
  .map((x) => x.index);

// CTA validity belongs to the editorial contract checker.
// Normalization must not abort before bounded repair gets a chance
// to fix missing/multiple CTA beats.
if (ctaIndexes.length === 1) {
  const ctaIndex = ctaIndexes[0];

  if (ctaIndex !== result.length - 1) {
    const [cta] = result.splice(ctaIndex, 1);
    result.push(cta);
  }
}
  const repaired = repairAdjacentSourceDuplicates(result);

  const target = clamp(Number(targetDuration) || 15, 8, 60);
  const total = repaired.reduce(
    (sum, x) => sum + Math.max(0, Number(x.source_end) - Number(x.source_start)),
    0,
  );

  if (total < target * 0.90) {
    let remaining = target - total;
    for (let i = repaired.length - 1; i >= 0 && remaining > 0.02; i--) {
      const shot = repaired[i];
      const src: any = byName.get(shot.source_filename);
      const sourceDuration = Number(src?.duration) || Number(shot.source_end);
      const room = Math.max(0, sourceDuration - Number(shot.source_end));
      const desired = i === repaired.length - 1 ? Math.max(0.8, remaining) : remaining;
      const add = Math.min(room, desired);
      if (add > 0) {
        shot.source_end = Number((Number(shot.source_end) + add).toFixed(3));
        remaining -= add;
      }
    }
  }

  const finalTotal = repaired.reduce(
    (sum, x) => sum + Math.max(0, Number(x.source_end) - Number(x.source_start)),
    0,
  );

  if (finalTotal < target * 0.90) {
    console.warn(
      `[ATLAS EDIT DIRECTOR] normalized timeline is short (${finalTotal.toFixed(2)}s vs target ${target.toFixed(2)}s); executable-timeline recovery will run before validation.`,
    );
  }

  return repaired;
}


const PACING_BOUNDS: Record<string, { min: number; max: number }> = {
  HOOK: { min: 0.80, max: 1.35 },
  STORY: { min: 0.65, max: 1.65 },
  PAYOFF: { min: 1.40, max: 2.40 },
  // Premium short-form CTA: readable, but never a frozen 2.5s+ end card.
  CTA: { min: 1.35, max: 1.90 },
};


function getEditorialViolations(timeline: any[], analyses: any[], brief: any) {
  const violations: string[] = [];
  const beats = Array.isArray(timeline) ? timeline : [];

  if (!beats.length) return { violations };

  const firstRole = String(beats[0]?.role || "").toUpperCase();
  const lastRole = String(beats[beats.length - 1]?.role || "").toUpperCase();

  if (firstRole !== "HOOK") {
    violations.push(`first beat must be HOOK, got ${firstRole || "UNKNOWN"}`);
  }
  if (lastRole !== "CTA") {
    violations.push(`last beat must be CTA, got ${lastRole || "UNKNOWN"}`);
  }

  const ctaCount = beats.filter(
    (x) => String(x?.role || "").toUpperCase() === "CTA",
  ).length;
  if (ctaCount !== 1) {
    violations.push(`CTA count must be exactly 1, got ${ctaCount}`);
  }

  const textBeats = beats.filter((x) => String(x?.text || "").trim().length > 0);
  if (textBeats.length > 3) {
    violations.push(`text is too dense: ${textBeats.length} text beats; maximum 3`);
  }

  if (!String(beats[0]?.text || "").trim()) {
    violations.push("HOOK must carry a concise on-screen text treatment");
  }

  if (!String(beats[beats.length - 1]?.text || "").trim()) {
    violations.push("CTA must carry a concise on-screen CTA treatment");
  }

  const hasPayoff = beats.some(
    (x) =>
      String(x?.role || "").toUpperCase() === "PAYOFF" ||
      ["TRANSFORMATION", "HERO"].includes(String(x?.beat_intent || "").toUpperCase()),
  );
  if (!hasPayoff) {
    violations.push("timeline has no clear PAYOFF/HERO/TRANSFORMATION beat");
  }

  const hasEscalation = beats.some(
    (x) => String(x?.beat_intent || "").toUpperCase() === "ESCALATION",
  );
  if (!hasEscalation && beats.length >= 7) {
    violations.push("timeline has no ESCALATION beat");
  }

  const nonCut = beats.filter((x, i) => {
    if (i === 0) return String(x?.transition_in || "CUT").toUpperCase() !== "CUT";
    return String(x?.transition_in || "CUT").toUpperCase() !== "CUT";
  }).length;
  if (nonCut > 6) {
    violations.push(`too many non-CUT transitions: ${nonCut}; maximum 6`);
  }

  const motionSet = new Set(
    beats
      .map((x) => String(x?.motion || "STATIC").toUpperCase())
      .filter(Boolean),
  );
  if (analyses.length >= 7 && beats.length >= 7 && motionSet.size < 3) {
    violations.push(`motion variety too low: ${motionSet.size} distinct treatments; expected at least 3`);
  }

  // Prevent adjacent beats from becoming the same visual idea even when the
  // source filenames differ. Compare the strongest explicit visual selectors.
  for (let i = 1; i < beats.length; i++) {
    const a = beats[i - 1];
    const b = beats[i];
    const sameSource = String(a?.source_filename) === String(b?.source_filename);
    const sameCrop = String(a?.crop_focus || "CENTER") === String(b?.crop_focus || "CENTER");
    const sameMotion = String(a?.motion || "STATIC") === String(b?.motion || "STATIC");
    const sameIntent = String(a?.beat_intent || "") === String(b?.beat_intent || "");
    const samePurpose =
      String(a?.purpose || "").trim().toLowerCase() ===
      String(b?.purpose || "").trim().toLowerCase();

    if (sameSource && sameCrop && sameMotion && (sameIntent || samePurpose)) {
      violations.push(`adjacent beats ${i} and ${i + 1} are too visually/editorially similar`);
    }
  }

  const hasCommercialObjective = JSON.stringify(brief || {}).toLowerCase().match(
    /(book|booking|buy|purchase|order|contact|visit|reserve|call|dm|cta|sale)/
  );
  if (hasCommercialObjective && !String(beats[beats.length - 1]?.text || "").trim()) {
    violations.push("commercial objective requires a readable final CTA text");
  }

  return { violations };
}

function getPacingViolations(timeline: any[], targetDuration: number) {
  const violations: string[] = [];
  let total = 0;

  for (const beat of timeline) {
    const role = String(beat?.role || "STORY").toUpperCase();
    const sourceSpan = Math.max(
      0,
      Number(beat?.source_end || 0) - Number(beat?.source_start || 0),
    );
    const speed = Math.max(0.5, Number(beat?.speed) || 1);
    const duration = sourceSpan / speed;
    total += duration;

    const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
    if (duration < bounds.min - 0.03) {
      violations.push(`${role} beat ${String(beat?.id || "?")} is too short (${duration.toFixed(2)}s; min ${bounds.min.toFixed(2)}s)`);
    }
    if (duration > bounds.max + 0.03) {
      violations.push(`${role} beat ${String(beat?.id || "?")} is too long (${duration.toFixed(2)}s; max ${bounds.max.toFixed(2)}s)`);
    }
  }

  const target = clamp(Number(targetDuration) || 15, 8, 60);
  if (total < target * 0.90) {
    violations.push(`timeline is too short (${total.toFixed(2)}s vs target ${target.toFixed(2)}s)`);
  }
  if (total > target * 1.03) {
    violations.push(`timeline is too long (${total.toFixed(2)}s vs target ${target.toFixed(2)}s)`);
  }

  return { violations, total };
}

function repairSourceDiversityAndMotion(
  timeline: any[],
  analyses: any[],
): any[] {
  const repaired = Array.isArray(timeline)
    ? timeline.map((x) => ({ ...x }))
    : [];

  // When enough real source files exist, deterministically replace later
  // duplicate-source beats with unused footage. This is a safety repair only;
  // it never invents a filename and it preserves the beat role/purpose.
  if (analyses.length >= 7 && repaired.length >= 7) {
    const target = Math.min(7, analyses.length);
    const available = [...analyses]
      .filter((x: any) => String(x?.filename || ""))
      .sort((a: any, b: any) => {
      const av = classifyCommercialVisual(a);
      const bv = classifyCommercialVisual(b);
      return (bv.hero * 3 + bv.detail - bv.action * 2 - bv.human * 2 + Number(b?.score || 0) * 0.15) -
             (av.hero * 3 + av.detail - av.action * 2 - av.human * 2 + Number(a?.score || 0) * 0.15);
    });

    const used = new Set(
      repaired.map((x) => String(x?.source_filename || "")).filter(Boolean),
    );
    const unused = available.filter(
      (x: any) => !used.has(String(x.filename)),
    );

    for (let i = repaired.length - 1; i >= 0 && used.size < target; i--) {
      const beat = repaired[i];
      if (String(beat?.role || "").toUpperCase() === "CTA") continue;

      const sourceName = String(beat?.source_filename || "");
      const occurrences = repaired.filter(
        (x) => String(x?.source_filename || "") === sourceName,
      ).length;
      if (occurrences <= 1 || !unused.length) continue;

      const replacement = unused.shift();
      if (!replacement) break;

      const duration = Math.max(0.25, Number(replacement.duration) || 0.25);
      const role = String(beat?.role || "STORY").toUpperCase();
      const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
      const suggestedStart = Number(replacement.suggested_start);
      const suggestedEnd = Number(replacement.suggested_end);
      let start = Number.isFinite(suggestedStart) ? suggestedStart : 0;
      let end = Number.isFinite(suggestedEnd) ? suggestedEnd : start + bounds.min;

      start = clamp(start, 0, Math.max(0, duration - 0.25));
      end = clamp(Math.max(start + bounds.min, end), start + bounds.min, duration);

      if (end - start > bounds.max) end = start + bounds.max;
      if (end > duration) {
        end = duration;
        start = Math.max(0, end - bounds.min);
      }
      if (end - start < bounds.min - 0.001) continue;

      beat.source_filename = String(replacement.filename);
      beat.source_start = Number(start.toFixed(3));
      beat.source_end = Number(end.toFixed(3));
      used.add(String(replacement.filename));
    }
  }

  // If the AI collapsed most beats onto one motion treatment, add restrained
  // deterministic variety. We prefer subtle movements over flashy effects.
  if (analyses.length >= 7 && repaired.length >= 7) {
    const preferred = ["PUSH_IN", "PULL_OUT", "PAN_LEFT", "PAN_RIGHT", "DRIFT"];
    const distinct = new Set(
      repaired.map((x) => cleanMotion(x?.motion)).filter(Boolean),
    );

    for (const motion of preferred) {
      if (distinct.size >= 3) break;
      if (distinct.has(motion)) continue;

      let bestIndex = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < repaired.length; i++) {
        const beat = repaired[i];
        const current = cleanMotion(beat?.motion);
        if (current === motion) continue;
        if (i > 0 && cleanMotion(repaired[i - 1]?.motion) === motion) continue;
        if (i + 1 < repaired.length && cleanMotion(repaired[i + 1]?.motion) === motion) continue;

        const role = String(beat?.role || "STORY").toUpperCase();
        const roleBonus = role === "HOOK" || role === "PAYOFF" || role === "CTA" ? 2 : 0;
        const score = Number(beat?.editorial_score || 0) + roleBonus;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      if (bestIndex >= 0) {
        repaired[bestIndex].motion = motion;
        distinct.add(motion);
      }
    }
  }

  return repaired;
}

function repairShotVariety(
  timeline: any[],
  analyses: any[],
): any[] {
  const repaired = Array.isArray(timeline)
    ? timeline.map((x) => ({ ...x }))
    : [];

  if (repaired.length < 4 || analyses.length < 4) return repaired;

  const sourceByName = new Map(
    analyses
      .filter((x: any) => String(x?.filename || ""))
      .map((x: any) => [String(x.filename), x]),
  );

  const shotTypeOf = (source: any) => {
    const raw = source?.shot_type ?? source?.shotType ?? source?.framing ?? source?.composition;
    const value = String(raw || "").trim().toUpperCase();
    if (!value) return "UNKNOWN";
    if (/EXTREME.?CLOSE|ECU/.test(value)) return "ECU";
    if (/CLOSE.?UP|\bCU\b/.test(value)) return "CU";
    if (/MEDIUM.?CLOSE|MCU/.test(value)) return "MCU";
    if (/MEDIUM.?SHOT|\bMS\b/.test(value)) return "MS";
    if (/WIDE|ESTABLISH|\bWS\b/.test(value)) return "WS";
    if (/OVERHEAD|TOP.?DOWN|BIRD/.test(value)) return "OVERHEAD";
    if (/DETAIL|MACRO/.test(value)) return "DETAIL";
    if (/POV|POINT.?OF.?VIEW/.test(value)) return "POV";
    return value;
  };

  const compatibleWithRole = (analysis: any, role: string) => {
    const type = shotTypeOf(analysis);
    if (type === "UNKNOWN") return false;
    if (role === "HOOK") return ["CU", "ECU", "DETAIL", "POV", "WS"].includes(type);
    if (role === "PAYOFF") return ["CU", "ECU", "MS", "WS", "OVERHEAD", "DETAIL"].includes(type);
    if (role === "CTA") return ["CU", "MS", "WS", "OVERHEAD", "DETAIL"].includes(type);
    return true;
  };

  const sourceDuration = (source: any) => Math.max(0.25, Number(source?.duration) || 0.25);
  const windowFor = (source: any, role: string) => {
    const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
    const duration = sourceDuration(source);
    const suggestedStart = Number(source?.suggested_start);
    const suggestedEnd = Number(source?.suggested_end);
    let start = Number.isFinite(suggestedStart) ? suggestedStart : 0;
    let end = Number.isFinite(suggestedEnd) ? suggestedEnd : start + bounds.min;
    start = clamp(start, 0, Math.max(0, duration - 0.25));
    end = clamp(Math.max(start + bounds.min, end), start + bounds.min, duration);
    if (end - start > bounds.max) end = Math.min(duration, start + bounds.max);
    if (end - start < bounds.min) {
      end = Math.min(duration, start + bounds.min);
      start = Math.max(0, end - bounds.min);
    }
    return { start, end };
  };

  const currentTypes = () =>
    repaired
      .map((beat) => shotTypeOf(sourceByName.get(String(beat?.source_filename || ""))))
      .filter((type) => type !== "UNKNOWN");

  const distinctTypes = () => new Set(currentTypes());
  const used = new Set(
    repaired.map((beat) => String(beat?.source_filename || "")).filter(Boolean),
  );

  // First priority: eliminate adjacent identical framing when another real
  // source with a different framing can perform the same editorial role.
  for (let i = 1; i < repaired.length; i++) {
    const previous = repaired[i - 1];
    const beat = repaired[i];
    if (String(beat?.role || "").toUpperCase() === "CTA") continue;

    const prevType = shotTypeOf(sourceByName.get(String(previous?.source_filename || "")));
    const currentSource = sourceByName.get(String(beat?.source_filename || ""));
    const currentType = shotTypeOf(currentSource);
    if (prevType === "UNKNOWN" || currentType === "UNKNOWN" || prevType !== currentType) continue;

    const role = String(beat?.role || "STORY").toUpperCase();
    const candidates = analyses
      .filter((source: any) => {
        const filename = String(source?.filename || "");
        const type = shotTypeOf(source);
        return filename &&
          !used.has(filename) &&
          type !== "UNKNOWN" &&
          type !== prevType &&
          compatibleWithRole(source, role) &&
          sourceDuration(source) >= 0.75;
      })
      .sort((a: any, b: any) => Number(b?.score || 0) - Number(a?.score || 0));

    const replacement = candidates[0];
    if (!replacement) continue;

    const window = windowFor(replacement, role);
    beat.source_filename = String(replacement.filename);
    beat.source_start = Number(window.start.toFixed(3));
    beat.source_end = Number(window.end.toFixed(3));
    beat.crop_focus = "CENTER";
    beat.editorial_score = Number(replacement?.score || beat.editorial_score || 0);
    used.add(String(replacement.filename));
  }

  // Second priority: when enough distinct shot types are actually available,
  // prefer at least three framing families across the edit. This is deliberately
  // conservative: it never replaces the hook, payoff, or CTA just to manufacture variety.
  if (analyses.length >= 5 && repaired.length >= 5 && distinctTypes().size < 3) {
    const targetTypes = ["WS", "MS", "CU", "OVERHEAD", "DETAIL", "POV", "ECU"];
    for (const targetType of targetTypes) {
      if (distinctTypes().size >= 3) break;
      if (distinctTypes().has(targetType)) continue;

      let bestIndex = -1;
      let bestReplacement: any = null;
      let bestScore = -Infinity;

      for (let i = 1; i < repaired.length - 1; i++) {
        const beat = repaired[i];
        const role = String(beat?.role || "STORY").toUpperCase();
        if (role === "HOOK" || role === "PAYOFF" || role === "CTA") continue;

        const candidates = analyses
          .filter((source: any) => {
            const filename = String(source?.filename || "");
            return filename &&
              !used.has(filename) &&
              shotTypeOf(source) === targetType &&
              sourceDuration(source) >= 0.75 &&
              compatibleWithRole(source, role);
          })
          .sort((a: any, b: any) => Number(b?.score || 0) - Number(a?.score || 0));

        const replacement = candidates[0];
        if (!replacement) continue;

        const neighborTypes = [
          shotTypeOf(sourceByName.get(String(repaired[i - 1]?.source_filename || ""))),
          shotTypeOf(sourceByName.get(String(repaired[i + 1]?.source_filename || ""))),
        ];
        const contrastBonus = neighborTypes.filter((type) => type !== targetType).length * 3;
        const score = Number(replacement?.score || 0) + contrastBonus;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
          bestReplacement = replacement;
        }
      }

      if (bestIndex >= 0 && bestReplacement) {
        const role = String(repaired[bestIndex]?.role || "STORY").toUpperCase();
        const window = windowFor(bestReplacement, role);
        repaired[bestIndex].source_filename = String(bestReplacement.filename);
        repaired[bestIndex].source_start = Number(window.start.toFixed(3));
        repaired[bestIndex].source_end = Number(window.end.toFixed(3));
        repaired[bestIndex].crop_focus = "CENTER";
        repaired[bestIndex].editorial_score = Number(bestReplacement?.score || repaired[bestIndex].editorial_score || 0);
        used.add(String(bestReplacement.filename));
      }
    }
  }

  return repaired;
}


function repairNarrativeSourceArc(timeline: any[], analyses: any[]): any[] {
  const repaired = Array.isArray(timeline) ? timeline.map((x) => ({ ...x })) : [];
  if (repaired.length < 5 || analyses.length < 5) return repaired;

  const byName = new Map((analyses || []).map((x: any) => [String(x?.filename || ""), x]));
  const familyOf = (source: any): string => commercialVisualFamily(source);

  const preferred: Record<string, string[]> = {
    HOOK_IMPACT: ["ACTION", "DETAIL", "CONTEXT", "HERO"],
    PROBLEM: ["HUMAN", "CONTEXT", "DETAIL", "ACTION"],
    ACTION: ["ACTION", "DETAIL", "HUMAN"],
    PROOF: ["DETAIL", "ACTION", "HUMAN", "HERO"],
    ESCALATION: ["ACTION", "HUMAN", "DETAIL"],
    TRANSFORMATION: ["HERO", "ACTION", "DETAIL"],
    HERO: ["HERO", "HUMAN", "CONTEXT"],
    CTA: ["HERO", "HUMAN", "CONTEXT", "DETAIL"],
  };

  const familyForBeat = (beat: any) => familyOf(byName.get(String(beat?.source_filename || "")));
  const scoreCandidate = (source: any, intent: string, neighbors: string[]) => {
    const family = familyOf(source);
    if (family === "UNKNOWN") return -1000;
    const prefs = preferred[intent] || ["ACTION", "DETAIL", "HUMAN", "HERO"];
    const rank = prefs.indexOf(family);
    let score = Number(source?.score || 0);
    if (rank >= 0) score += 35 - rank * 8;
    if (neighbors.includes(family)) score -= 24;
    if (intent === "HOOK_IMPACT" && family === "ACTION") score += 12;
    if (intent === "HERO" && family === "HERO") score += 12;
    return score;
  };

  const used = new Set(repaired.map((b) => String(b?.source_filename || "")).filter(Boolean));
  for (let i = 0; i < repaired.length; i++) {
    const beat = repaired[i];
    const intent = String(beat?.beat_intent || (i === 0 ? "HOOK_IMPACT" : i === repaired.length - 1 ? "CTA" : "ACTION")).toUpperCase();
    if (intent === "CTA") continue;

    const currentFamily = familyForBeat(beat);
    const neighbors = [familyForBeat(repaired[i - 1]), familyForBeat(repaired[i + 1])].filter((x) => x !== "UNKNOWN");
    const prefs = preferred[intent] || ["ACTION", "DETAIL", "HUMAN", "HERO"];
    const currentGood = prefs.includes(currentFamily) && !neighbors.every((x) => x === currentFamily);
    if (currentGood) continue;

    const replacement = analyses
      .filter((source: any) => {
        const filename = String(source?.filename || "");
        return filename && filename !== String(beat?.source_filename || "") && Number(source?.duration || 0) >= 0.75 && !used.has(filename) && familyOf(source) !== "UNKNOWN";
      })
      .sort((a: any, b: any) => scoreCandidate(b, intent, neighbors) - scoreCandidate(a, intent, neighbors))[0];

    if (!replacement || scoreCandidate(replacement, intent, neighbors) < 0) continue;
    const duration = Math.max(0.25, Number(replacement.duration) || 0.25);
    const role = String(beat?.role || "STORY").toUpperCase();
    const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
    let start = Number.isFinite(Number(replacement?.suggested_start)) ? Number(replacement.suggested_start) : 0;
    let end = Number.isFinite(Number(replacement?.suggested_end)) ? Number(replacement.suggested_end) : start + bounds.min;
    start = clamp(start, 0, Math.max(0, duration - 0.25));
    end = clamp(Math.max(start + bounds.min, end), start + bounds.min, duration);
    if (end - start > bounds.max) end = Math.min(duration, start + bounds.max);
    if (end - start < bounds.min) continue;

    used.delete(String(beat?.source_filename || ""));
    beat.source_filename = String(replacement.filename);
    beat.source_start = Number(start.toFixed(3));
    beat.source_end = Number(end.toFixed(3));
    beat.crop_focus = intent === "HOOK_IMPACT" ? "ACTION" : intent === "HERO" || intent === "TRANSFORMATION" ? "PRODUCT" : "CENTER";
    beat.editorial_score = Math.max(Number(beat?.editorial_score || 0), Number(replacement?.score || 0));
    used.add(String(replacement.filename));
  }
  return repaired;
}

function repairEditorialContract(candidate: any[], analyses: any[], targetDuration: number) {
  const repaired = Array.isArray(candidate) ? candidate.map((x) => ({ ...x })) : [];

  // Mechanical contract repair only: keep the director's source/order/intent,
  // but enforce safe editorial duration bounds and text density before validation.
  const byName = new Map((analyses || []).map((x: any) => [String(x.filename), x]));

  for (const beat of repaired) {
    const role = String(beat?.role || "STORY").toUpperCase();
    const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
    const source = byName.get(String(beat?.source_filename || ""));
    const sourceDuration = Number(source?.duration) || 0;
    let start = Number(beat?.source_start);
    let end = Number(beat?.source_end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    start = Math.max(0, start);
    end = Math.max(start, end);

    // First enforce the maximum.
    if (end - start > bounds.max) {
      end = start + bounds.max;
    }

    // Then enforce the minimum by expanding inside the real source duration.
    // Prefer extending the end; if that is impossible, move the start backward.
    if (end - start < bounds.min) {
      const needed = bounds.min - (end - start);
      const roomAfter = sourceDuration > 0 ? Math.max(0, sourceDuration - end) : needed;
      const addAfter = Math.min(needed, roomAfter);
      end += addAfter;

      const stillNeeded = bounds.min - (end - start);
      if (stillNeeded > 0.001) {
        const addBefore = Math.min(stillNeeded, Math.max(0, start));
        start -= addBefore;
        end = Math.min(sourceDuration > 0 ? sourceDuration : end, start + bounds.min);
      }
    }

    if (sourceDuration > 0) {
      start = Math.min(start, Math.max(0, sourceDuration - 0.25));
      end = Math.min(end, sourceDuration);
    }

    beat.source_start = Number(start.toFixed(3));
    beat.source_end = Number(end.toFixed(3));
  }

  // Keep typography sparse: HOOK + strongest payoff/transform beat + CTA.
  const textIndexes = repaired
    .map((beat, index) => ({ beat, index }))
    .filter(({ beat }) => String(beat?.text || "").trim().length > 0);

  if (textIndexes.length > 3) {
    const keep = new Set<number>();
    if (repaired.length) keep.add(0);
    if (repaired.length) keep.add(repaired.length - 1);

    const payoffIndex = repaired.findIndex((beat) =>
      String(beat?.role || "").toUpperCase() === "PAYOFF" ||
      ["TRANSFORMATION", "HERO"].includes(String(beat?.beat_intent || "").toUpperCase()),
    );
    if (payoffIndex >= 0) keep.add(payoffIndex);

    for (const { index } of textIndexes) {
      if (keep.size >= 3) break;
      keep.add(index);
    }

    for (const { beat, index } of textIndexes) {
      if (!keep.has(index)) beat.text = "";
    }
  }

  // If trimming role maxima still leaves more than the target + 3%, remove
  // excess time from the longest editable beats without touching source choice.
  const target = clamp(Number(targetDuration) || 15, 8, 60);
  const maxTotal = target * 1.03;
  let total = repaired.reduce(
    (sum, beat) => sum + Math.max(0, Number(beat?.source_end || 0) - Number(beat?.source_start || 0)),
    0,
  );

  if (total > maxTotal) {
    const order = repaired
      .map((beat, index) => ({ beat, index }))
      .sort((a, b) => {
        const da = Number(a.beat.source_end) - Number(a.beat.source_start);
        const db = Number(b.beat.source_end) - Number(b.beat.source_start);
        return db - da;
      });

    for (const { beat } of order) {
      if (total <= maxTotal + 0.001) break;
      const role = String(beat?.role || "STORY").toUpperCase();
      const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
      const start = Number(beat.source_start);
      const end = Number(beat.source_end);
      const duration = end - start;
      const removable = Math.max(0, duration - bounds.min);
      const cut = Math.min(removable, total - maxTotal);
      if (cut > 0) {
        beat.source_end = Number((end - cut).toFixed(3));
        total -= cut;
      }
    }
  }

  // Deterministic role normalization: the first beat must be the HOOK and
  // the final beat must be the CTA. Prefer moving an existing matching beat
  // rather than rewriting creative content. This prevents a bounded AI repair
  // from leaving the timeline structurally invalid after all other repairs.
  if (repaired.length) {
    const hookIndex = repaired.findIndex((beat) =>
      String(beat?.role || "").toUpperCase() === "HOOK" ||
      String(beat?.beat_intent || "").toUpperCase() === "HOOK_IMPACT",
    );
    if (hookIndex > 0) {
      const [hook] = repaired.splice(hookIndex, 1);
      repaired.unshift(hook);
    } else if (hookIndex < 0) {
      repaired[0].role = "HOOK";
      repaired[0].beat_intent = "HOOK_IMPACT";
    }

    const ctaIndex = repaired.findIndex((beat) =>
      String(beat?.role || "").toUpperCase() === "CTA",
    );
    if (ctaIndex >= 0 && ctaIndex !== repaired.length - 1) {
      const [cta] = repaired.splice(ctaIndex, 1);
      repaired.push(cta);
    } else if (ctaIndex < 0) {
      repaired[repaired.length - 1].role = "CTA";
      repaired[repaired.length - 1].beat_intent = "CTA";
    }

    // Re-apply the sparse typography rule after role normalization so the
    // structural repair can never leave four or more text beats behind.
    const textIndexesAfterRoles = repaired
      .map((beat, index) => ({ beat, index }))
      .filter(({ beat }) => String(beat?.text || "").trim().length > 0);
    if (textIndexesAfterRoles.length > 3) {
      const keep = new Set<number>([0, repaired.length - 1]);
      const payoffIndex = repaired.findIndex((beat) =>
        String(beat?.role || "").toUpperCase() === "PAYOFF" ||
        ["TRANSFORMATION", "HERO"].includes(String(beat?.beat_intent || "").toUpperCase()),
      );
      if (payoffIndex >= 0) keep.add(payoffIndex);
      for (const { index } of textIndexesAfterRoles) {
        if (keep.size >= 3) break;
        keep.add(index);
      }
      for (const { beat, index } of textIndexesAfterRoles) {
        if (!keep.has(index)) beat.text = "";
      }
    }
  }

  const varied = repairShotVariety(repairSourceDiversityAndMotion(repaired, analyses), analyses);
  const arced = repairNarrativeSourceArc(varied, analyses);
  return repairTransitionIntelligence(arced, analyses);
}


const NARRATIVE_INTENT_BY_COUNT: Record<number, AtlasBeatIntent[]> = {
  7: ["HOOK_IMPACT", "PROBLEM", "ACTION", "PROOF", "ESCALATION", "HERO", "CTA"],
  8: ["HOOK_IMPACT", "PROBLEM", "ACTION", "PROOF", "ESCALATION", "TRANSFORMATION", "HERO", "CTA"],
  9: ["HOOK_IMPACT", "PROBLEM", "ACTION", "PROOF", "ESCALATION", "ACTION", "TRANSFORMATION", "HERO", "CTA"],
  10: ["HOOK_IMPACT", "PROBLEM", "ACTION", "PROOF", "ESCALATION", "ACTION", "TRANSFORMATION", "HERO", "BREATH", "CTA"],
};

function getNarrativeIntentSequence(length: number): AtlasBeatIntent[] {
  if (NARRATIVE_INTENT_BY_COUNT[length]) return [...NARRATIVE_INTENT_BY_COUNT[length]];
  if (length <= 7) return [...NARRATIVE_INTENT_BY_COUNT[7]];
  const base = [...NARRATIVE_INTENT_BY_COUNT[10]];
  if (length > 10) {
    while (base.length < length) base.splice(base.length - 1, 0, "ACTION");
  } else {
    base.length = length;
  }
  base[0] = "HOOK_IMPACT";
  base[base.length - 1] = "CTA";
  return base;
}

const IDEAL_DURATION_BY_INTENT: Record<string, number> = {
  HOOK_IMPACT: 0.95,
  PROBLEM: 0.80,
  ACTION: 1.10,
  PROOF: 1.15,
  ESCALATION: 0.95,
  TRANSFORMATION: 1.25,
  HERO: 1.65,
  REACTION: 0.85,
  BRIDGE: 0.65,
  BREATH: 0.55,
  CTA: 2.30,
};

function fitWindowToDuration(
  start: number,
  end: number,
  sourceDuration: number,
  desired: number,
) {
  const d = Math.max(0.25, Math.min(desired, sourceDuration));
  const center = (start + end) / 2;
  let nextStart = center - d / 2;
  let nextEnd = center + d / 2;
  if (nextStart < 0) {
    nextEnd -= nextStart;
    nextStart = 0;
  }
  if (nextEnd > sourceDuration) {
    nextStart -= nextEnd - sourceDuration;
    nextEnd = sourceDuration;
  }
  nextStart = clamp(nextStart, 0, Math.max(0, sourceDuration - 0.25));
  nextEnd = clamp(nextEnd, nextStart + 0.25, sourceDuration);
  return { start: nextStart, end: nextEnd };
}

/**
 * STORY-FIRST SOURCE ASSIGNMENT
 * Score real Vision sources against the editorial job of each beat before
 * moment-window refinement. Diversity is a preference, not the story itself.
 */
function assignNarrativeSources(
  timeline: any[],
  analyses: any[],
  momentCandidates: AtlasMomentCandidate[],
) {
  const beats = Array.isArray(timeline) ? timeline.map((x) => ({ ...x })) : [];
  if (beats.length < 2 || analyses.length < 2) return beats;

  const usable = analyses.filter((x: any) => String(x?.filename || "") && Number(x?.duration || 0) >= 0.25);
  if (!usable.length) return beats;

  const textOf = (source: any) => [
    source?.shot_type, source?.recommended_use, source?.reason, source?.strengths,
    source?.problems, source?.description, source?.subject, source?.action,
    source?.composition,
  ].flatMap((v: any) => Array.isArray(v) ? v : [v])
    .map((v: any) => String(v || "").toLowerCase()).join(" ");

  const familyOf = (source: any) => commercialVisualFamily(source);

  const preferredFamilies: Record<string, string[]> = {
    HOOK_IMPACT: ["ACTION", "DETAIL", "HERO", "CONTEXT", "HUMAN"],
    PROBLEM: ["HUMAN", "CONTEXT", "DETAIL", "ACTION", "HERO"],
    ACTION: ["ACTION", "DETAIL", "HUMAN", "HERO", "CONTEXT"],
    PROOF: ["DETAIL", "ACTION", "HERO", "HUMAN", "CONTEXT"],
    ESCALATION: ["ACTION", "DETAIL", "HUMAN", "HERO", "CONTEXT"],
    TRANSFORMATION: ["HERO", "ACTION", "DETAIL", "HUMAN", "CONTEXT"],
    HERO: ["HERO", "HUMAN", "CONTEXT", "DETAIL", "ACTION"],
    CTA: ["HERO", "CONTEXT", "HUMAN", "DETAIL", "ACTION"],
  };

  const preferredMomentTypes: Record<string, string[]> = {
    HOOK_IMPACT: ["ACTION_PEAK", "MOTION_PEAK", "REVEAL", "HERO_FRAME"],
    PROBLEM: ["REACTION", "ESTABLISH", "DETAIL", "BEST_WINDOW"],
    ACTION: ["ACTION_PEAK", "MOTION_PEAK", "TRANSFORMATION"],
    PROOF: ["REVEAL", "HERO_FRAME", "DETAIL", "BEST_WINDOW"],
    ESCALATION: ["ACTION_PEAK", "MOTION_PEAK", "TRANSFORMATION"],
    TRANSFORMATION: ["TRANSFORMATION", "REVEAL", "HERO_FRAME"],
    HERO: ["HERO_FRAME", "REVEAL", "BEST_WINDOW"],
    CTA: ["HERO_FRAME", "REVEAL", "BEST_WINDOW"],
  };

  const momentScore = (sourceName: string, intent: string) => {
    const candidates = momentCandidates.filter((m) => m.sourceFilename === sourceName);
    if (!candidates.length) return 0;
    const types = preferredMomentTypes[intent] || [];
    return Math.max(...candidates.map((m) => {
      const type = String(m?.type || "").toUpperCase();
      const fit = Array.isArray(m?.beatFit) ? m.beatFit.map(String).map((x) => x.toUpperCase()) : [];
      return Math.min(100, Number(m?.score || 0)) + (fit.includes(intent) ? 35 : 0) + (types.includes(type) ? 25 : 0);
    }));
  };

  const sourceScore = (source: any, intent: string, index: number) => {
    const family = familyOf(source);
    const preferred = preferredFamilies[intent] || ["ACTION", "DETAIL", "HERO", "HUMAN", "CONTEXT"];
    const rank = preferred.indexOf(family);
    let score = (rank < 0 ? 0 : 42 - rank * 8) + Math.min(30, Math.max(0, Number(source?.score || 0)));
    score += Math.min(28, momentScore(String(source?.filename || ""), intent) * 0.28);
    if (index === 0 && ["ACTION", "DETAIL", "HERO"].includes(family)) score += 10;
    if (intent === "CTA" && family === "HERO") score += 35;
    if (intent === "CTA" && family === "ACTION") score -= 22;
    if (intent === "PROBLEM" && family === "HUMAN") score += 8;
    if (intent === "ESCALATION" && family === "ACTION") score += 10;
    if (intent === "TRANSFORMATION" && family === "HERO") score += 14;
    if (intent === "HERO" && family === "HERO") score += 18;
    return score;
  };

  const ctaIndex = beats.length - 1;
  const heroSources = usable.filter((source: any) => familyOf(source) === "HERO")
    .sort((a: any, b: any) => sourceScore(b, "CTA", ctaIndex) - sourceScore(a, "CTA", ctaIndex));
  const reservedCta = heroSources[0] || null;
  const used = new Set<string>();

  if (reservedCta) {
    beats[ctaIndex].source_filename = String(reservedCta.filename);
    used.add(String(reservedCta.filename));
  }

  for (let i = 0; i < ctaIndex; i++) {
    const beat = beats[i];
    const intent = String(beat?.beat_intent || (i === 0 ? "HOOK_IMPACT" : "ACTION")).toUpperCase();
    const previousSource = usable.find((x: any) => String(x?.filename || "") === String(beats[i - 1]?.source_filename || ""));
    const previousFamily = i > 0 ? familyOf(previousSource) : "";

    const ranked = usable.map((source: any) => {
      const filename = String(source?.filename || "");
      const family = familyOf(source);
      let score = sourceScore(source, intent, i);
      if (!filename || filename === String(beats[ctaIndex]?.source_filename || "")) score = -Infinity;
      if (used.has(filename)) score -= 32;
      if (previousFamily && family === previousFamily) score -= 24;
      if (["TRANSFORMATION", "HERO"].includes(intent) && family === "HUMAN") score -= 18;
      return { source, score };
    }).sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best || !Number.isFinite(best.score)) continue;

    const current = usable.find((x: any) => String(x?.filename || "") === String(beat?.source_filename || ""));
    if (current) {
      const currentScore = sourceScore(current, intent, i) - (used.has(String(current.filename)) ? 32 : 0);
      if (String(best.source.filename) !== String(current.filename) && best.score - currentScore < 10) {
        used.add(String(current.filename));
        continue;
      }
    }

    beat.source_filename = String(best.source.filename);
    beat.editorial_score = Math.max(Number(beat?.editorial_score || 0), Number(best.source?.score || 0));
    used.add(String(best.source.filename));
  }

  if (reservedCta) {
    beats[ctaIndex].source_filename = String(reservedCta.filename);
    beats[ctaIndex].beat_intent = "CTA";
    beats[ctaIndex].role = "CTA";
    beats[ctaIndex].cut_on = "REVEAL";
    beats[ctaIndex].editorial_score = Math.max(Number(beats[ctaIndex]?.editorial_score || 0), Number(reservedCta?.score || 0));
  }

  return beats;
}

function refineNarrativePacingAndAction(
  timeline: any[],
  analyses: any[],
  momentCandidates: AtlasMomentCandidate[],
  targetDuration: number,
) {
  const repaired = Array.isArray(timeline) ? timeline.map((x) => ({ ...x })) : [];
  if (repaired.length < 2) return repaired;

  const sequence = getNarrativeIntentSequence(repaired.length);
  const sourceByName = new Map(
    analyses.map((x: any) => [String(x?.filename || ""), x]),
  );

  const candidateForIntent = (sourceName: string, intent: AtlasBeatIntent) => {
    const candidates = momentCandidates.filter(
      (m) => m.sourceFilename === sourceName,
    );
    if (!candidates.length) return null;

    const intentText = String(intent).toUpperCase();
    const typeForIntent: Record<string, string[]> = {
      HOOK_IMPACT: ["ACTION_PEAK", "MOTION_PEAK", "REVEAL", "HERO_FRAME"],
      PROBLEM: ["DETAIL", "REACTION", "ESTABLISH", "BEST_WINDOW"],
      ACTION: ["ACTION_PEAK", "MOTION_PEAK", "TRANSFORMATION"],
      PROOF: ["REVEAL", "HERO_FRAME", "BEST_WINDOW"],
      ESCALATION: ["ACTION_PEAK", "MOTION_PEAK", "TRANSFORMATION"],
      TRANSFORMATION: ["TRANSFORMATION", "REVEAL", "HERO_FRAME"],
      HERO: ["HERO_FRAME", "REVEAL", "BEST_WINDOW"],
      REACTION: ["REACTION", "HERO_FRAME"],
      BREATH: ["BREATH", "HERO_FRAME", "DETAIL"],
      BRIDGE: ["DETAIL", "MOTION_PEAK", "BEST_WINDOW"],
    };
    const preferred = typeForIntent[intentText] || [];
    return [...candidates].sort((a, b) => {
      const aFit = Array.isArray(a.beatFit) && a.beatFit.map(String).some((v) => v.toUpperCase() === intentText) ? 100 : 0;
      const bFit = Array.isArray(b.beatFit) && b.beatFit.map(String).some((v) => v.toUpperCase() === intentText) ? 100 : 0;
      const aType = preferred.includes(String(a.type).toUpperCase()) ? 40 : 0;
      const bType = preferred.includes(String(b.type).toUpperCase()) ? 40 : 0;
      return (b.score + bFit + bType) - (a.score + aFit + aType);
    })[0];
  };

  for (let i = 0; i < repaired.length; i++) {
    const beat = repaired[i];
    const intent = sequence[i] || (i === 0 ? "HOOK_IMPACT" : i === repaired.length - 1 ? "CTA" : "ACTION");
    beat.beat_intent = intent;

    if (i === 0) beat.role = "HOOK";
    else if (i === repaired.length - 1) beat.role = "CTA";
    else if (intent === "HERO" || intent === "TRANSFORMATION") beat.role = "PAYOFF";
    else beat.role = "STORY";

    if (intent === "CTA") continue;

    const sourceName = String(beat?.source_filename || "");
    const source = sourceByName.get(sourceName);
    const sourceDuration = Number(source?.duration) || Number(beat?.source_end || 0);
    if (sourceDuration <= 0) continue;

    const candidate = candidateForIntent(sourceName, intent);
    if (candidate) {
      const type = String(candidate.type || "").toUpperCase();
      const temporal = ["ACTION_PEAK", "MOTION_PEAK", "REVEAL", "TRANSFORMATION"].includes(type);
      if (temporal) {
        // Preserve a short lead-in and put the outgoing cut immediately after the event.
        const center = (Number(candidate.start) + Number(candidate.end)) / 2;
        const desired = IDEAL_DURATION_BY_INTENT[intent] || 1.1;
        const tail = ["REVEAL", "TRANSFORMATION"].includes(type) ? 0.16 : 0.10;
        const end = clamp(center + tail, 0.25, sourceDuration);
        const start = clamp(end - desired, 0, Math.max(0, sourceDuration - 0.25));
        beat.source_start = Number(start.toFixed(3));
        beat.source_end = Number(end.toFixed(3));
        beat.moment_candidate_id = candidate.id;
        beat.source_moment = momentToSourceMoment(candidate);
        beat.cut_on = ["REVEAL", "TRANSFORMATION"].includes(type) ? "REVEAL" : "ACTION_PEAK";
        beat.cut_reason = `Narrative ${intent.toLowerCase()} cuts on ${type.toLowerCase()} for a deliberate editorial beat.`;
      } else {
        const window = fitWindowToDuration(
          Number(candidate.start) || 0,
          Number(candidate.end) || Math.min(sourceDuration, 1),
          sourceDuration,
          IDEAL_DURATION_BY_INTENT[intent] || 1.1,
        );
        beat.source_start = Number(window.start.toFixed(3));
        beat.source_end = Number(window.end.toFixed(3));
        beat.moment_candidate_id = candidate.id;
        beat.source_moment = momentToSourceMoment(candidate);
      }
    } else {
      const currentStart = Number(beat?.source_start);
      const currentEnd = Number(beat?.source_end);
      if (Number.isFinite(currentStart) && Number.isFinite(currentEnd)) {
        const window = fitWindowToDuration(
          currentStart,
          currentEnd,
          sourceDuration,
          IDEAL_DURATION_BY_INTENT[intent] || 1.1,
        );
        beat.source_start = Number(window.start.toFixed(3));
        beat.source_end = Number(window.end.toFixed(3));
      }
    }
  }

  // Keep the CTA as the only final beat and give it a clean, short commercial landing.
  const cta = repaired[repaired.length - 1];
  const ctaSource = sourceByName.get(String(cta?.source_filename || ""));
  const ctaDuration = Number(ctaSource?.duration) || Number(cta?.source_end || 0);
  if (ctaDuration > 0) {
    const desired = IDEAL_DURATION_BY_INTENT.CTA;
    const currentStart = Number(cta?.source_start);
    const currentEnd = Number(cta?.source_end);
    if (Number.isFinite(currentStart) && Number.isFinite(currentEnd)) {
      const window = fitWindowToDuration(currentStart, currentEnd, ctaDuration, desired);
      cta.source_start = Number(window.start.toFixed(3));
      cta.source_end = Number(window.end.toFixed(3));
    }
  }

  // Nudge the middle toward the target without creating long holds. Expand the
  // strongest STORY/PAYOFF beats first, never the HOOK or CTA beyond their caps.
  const target = clamp(Number(targetDuration) || 15, 8, 60);
  const currentTotal = () => repaired.reduce(
    (sum, x) => sum + Math.max(0, Number(x?.source_end || 0) - Number(x?.source_start || 0)),
    0,
  );
  let deficit = target * 0.97 - currentTotal();
  if (deficit > 0) {
    const priority = repaired
      .map((beat, index) => ({ beat, index }))
      .filter(({ beat }) => String(beat?.role || "").toUpperCase() !== "CTA")
      .sort((a, b) => {
        const pa = ["HERO", "TRANSFORMATION", "PROOF", "ACTION"].indexOf(String(a.beat?.beat_intent || ""));
        const pb = ["HERO", "TRANSFORMATION", "PROOF", "ACTION"].indexOf(String(b.beat?.beat_intent || ""));
        return pb - pa;
      });
    for (const { beat } of priority) {
      if (deficit <= 0) break;
      const role = String(beat?.role || "STORY").toUpperCase();
      const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
      const source = sourceByName.get(String(beat?.source_filename || ""));
      const sourceDuration = Number(source?.duration) || 0;
      const start = Number(beat?.source_start);
      const end = Number(beat?.source_end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || sourceDuration <= 0) continue;
      const room = Math.max(0, bounds.max - (end - start));
      const add = Math.min(deficit, room, Math.max(0, sourceDuration - end));
      if (add > 0) {
        beat.source_end = Number((end + add).toFixed(3));
        deficit -= add;
      }
    }
  }

  return repaired;
}


/**
 * V18 COMMERCIAL FINAL POLISH
 * Editorial constraints are deterministic here: the AI chooses the story,
 * but commercial landing, repetition, transition restraint and duration
 * are enforced before the executable plan is built.
 */
function applyCommercialFinalPolish(
  timeline: any[],
  analyses: any[],
  brief: any,
  targetDuration: number,
) {
  const repaired = Array.isArray(timeline) ? timeline.map((x) => ({ ...x })) : [];
  if (!repaired.length || !analyses?.length) return repaired;

  const text = JSON.stringify(brief || {}).toLowerCase();
  const sourceText = (source: any) => [
    source?.shot_type, source?.shotType, source?.recommended_use,
    source?.reason, source?.strengths, source?.description, source?.summary,
    source?.subject, source?.action, source?.composition,
  ].flatMap((v: any) => Array.isArray(v) ? v : [v])
    .map((v: any) => String(v || "").toLowerCase()).join(" ");

  const allText = `${text} ${analyses.map(sourceText).join(" ")}`;
  const isFoodCommercial = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/.test(allText);

  const familyOf = (source: any) => {
    const t = sourceText(source);
    if (/(finished|plated|hero|signature dish|final dish|food showcase|dish reveal|menu hero|beauty shot)/.test(t)) return "HERO";
    if (/(customer|guest|people|person|woman|man|eating|dining|server|waiter|reaction|lifestyle)/.test(t)) return "HUMAN";
    if (/(flame|torch|fire|knife|slice|slicing|cutting|rolling|shaping|assembling|placing|plating|chef|cooking|cook|prep|process|craft)/.test(t)) return "ACTION";
    if (/(salmon|fish|rice|garnish|ingredient|texture|macro|detail|sauce|sushi close)/.test(t)) return "DETAIL";
    if (/(overhead|top.?down|wide|establish|environment|interior|exterior|restaurant|context|room)/.test(t)) return "CONTEXT";
    return "OTHER";
  };

  const byName = new Map(analyses.map((x: any) => [String(x?.filename || ""), x]));
  const ctaIndex = repaired.length - 1;

  // Commercial landing: a CTA should finish on a clean product/hero visual
  // whenever the real footage contains one. Never use an eating/reaction
  // source for the final CTA when a stronger hero source exists.
  const heroCandidates = analyses
    .filter((x: any) => String(x?.filename || "") && familyOf(x) === "HERO")
    .sort((a: any, b: any) => Number(b?.score || 0) - Number(a?.score || 0));

  if (isFoodCommercial && heroCandidates.length) {
    const bestHero = heroCandidates[0];
    const currentCta = byName.get(String(repaired[ctaIndex]?.source_filename || ""));
    if (familyOf(currentCta) !== "HERO" || classifyCommercialVisual(currentCta).action >= 8) {
      const duration = Math.max(0.75, Number(bestHero?.duration) || 0.75);
      const bounds = PACING_BOUNDS.CTA;
      const preferredStart = Number(bestHero?.suggested_start);
      const preferredEnd = Number(bestHero?.suggested_end);
      let start = Number.isFinite(preferredStart) ? preferredStart : 0;
      let end = Number.isFinite(preferredEnd) ? preferredEnd : Math.min(duration, start + bounds.max);
      start = clamp(start, 0, Math.max(0, duration - 0.25));
      end = clamp(Math.max(start + bounds.min, end), start + bounds.min, duration);
      if (end - start > bounds.max) end = Math.min(duration, start + bounds.max);
      if (end - start >= bounds.min - 0.01) {
        repaired[ctaIndex].source_filename = String(bestHero.filename);
        repaired[ctaIndex].source_start = Number(start.toFixed(3));
        repaired[ctaIndex].source_end = Number(end.toFixed(3));
        repaired[ctaIndex].crop_focus = "PRODUCT";
        repaired[ctaIndex].editorial_score = Math.max(
          Number(repaired[ctaIndex]?.editorial_score || 0),
          Number(bestHero?.score || 0),
        );
      }
    }
  }

  // Do not let the final two beats become a human-reaction/eating block when
  // product payoff footage exists. Replace the penultimate beat only when an
  // unused non-human source can perform the same editorial job.
  if (isFoodCommercial && repaired.length >= 3) {
    const penultimateIndex = repaired.length - 2;
    const penultimate = repaired[penultimateIndex];
    const penSource = byName.get(String(penultimate?.source_filename || ""));
    if (familyOf(penSource) === "HUMAN") {
      const used = new Set(repaired.map((x: any) => String(x?.source_filename || "")));
      const candidates = analyses
        .filter((x: any) => {
          const name = String(x?.filename || "");
          return name && !used.has(name) && familyOf(x) !== "HUMAN" && Number(x?.duration || 0) >= 0.75;
        })
        .sort((a: any, b: any) => {
          const familyRank = (x: string) => x === "HERO" ? 4 : x === "ACTION" ? 3 : x === "DETAIL" ? 2 : x === "CONTEXT" ? 1 : 0;
          return (familyRank(familyOf(b)) + Number(b?.score || 0) * 0.02) -
                 (familyRank(familyOf(a)) + Number(a?.score || 0) * 0.02);
        });
      const replacement = candidates[0];
      if (replacement) {
        const role = String(penultimate?.role || "PAYOFF").toUpperCase();
        const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.PAYOFF;
        const duration = Math.max(0.75, Number(replacement.duration) || 0.75);
        let start = Number.isFinite(Number(replacement.suggested_start)) ? Number(replacement.suggested_start) : 0;
        let end = Number.isFinite(Number(replacement.suggested_end)) ? Number(replacement.suggested_end) : start + bounds.min;
        start = clamp(start, 0, Math.max(0, duration - 0.25));
        end = clamp(Math.max(start + bounds.min, end), start + bounds.min, duration);
        if (end - start > bounds.max) end = Math.min(duration, start + bounds.max);
        if (end - start >= bounds.min - 0.01) {
          penultimate.source_filename = String(replacement.filename);
          penultimate.source_start = Number(start.toFixed(3));
          penultimate.source_end = Number(end.toFixed(3));
          penultimate.crop_focus = familyOf(replacement) === "HERO" ? "PRODUCT" : "CENTER";
          penultimate.editorial_score = Math.max(
            Number(penultimate?.editorial_score || 0),
            Number(replacement?.score || 0),
          );
        }
      }
    }
  }

  // Premium food/commercial edits should not throw a transition at every cut.
  // CUT is the default; keep only two earned non-CUT edges and prefer subtle
  // MATCH/ZOOM over WHIP/PUNCH/FLASH.
  if (isFoodCommercial && repaired.length > 1) {
    let nonCutKept = 0;
    for (let i = 1; i < repaired.length; i++) {
      const beat = repaired[i];
      const requested = String(beat?.transition_in || "CUT").toUpperCase();
      const allowed = requested === "MATCH" || requested === "ZOOM";
      if (allowed && nonCutKept < 2) {
        beat.transition_in = requested;
        beat.transition_out = requested;
        beat.transition_duration = Math.min(0.14, Math.max(0.10, Number(beat?.transition_duration) || 0.12));
        nonCutKept++;
      } else {
        beat.transition_in = "CUT";
        beat.transition_out = "CUT";
        beat.transition_duration = 0;
      }
    }
  }

  // Duration must be measured after transition overlap, because that is what
  // the renderer actually outputs. Expand eligible source windows toward their
  // role caps until the final executable duration is close to target.
  const target = clamp(Number(targetDuration) || 15, 8, 60);
  const effectiveDuration = () => {
    let total = 0;
    for (let i = 0; i < repaired.length; i++) {
      total += Math.max(0, Number(repaired[i]?.source_end || 0) - Number(repaired[i]?.source_start || 0));
      if (i > 0) {
        const t = String(repaired[i]?.transition_in || "CUT").toUpperCase();
        if (t !== "CUT") total -= Math.min(
          0.25,
          Math.max(0, Number(repaired[i]?.transition_duration) || 0.12),
        );
      }
    }
    return total;
  };

  let deficit = target * 0.97 - effectiveDuration();
  if (deficit > 0) {
    const order = repaired
      .map((beat: any, index: number) => ({ beat, index }))
      .filter(({ index }) => index !== 0)
      .sort((a, b) => {
        const ia = String(a.beat?.beat_intent || "").toUpperCase();
        const ib = String(b.beat?.beat_intent || "").toUpperCase();
        const rank = (x: string) => x === "HERO" ? 5 : x === "TRANSFORMATION" ? 4 : x === "PROOF" ? 3 : x === "ACTION" ? 2 : x === "ESCALATION" ? 2 : 1;
        return rank(ib) - rank(ia);
      });

    for (const { beat } of order) {
      if (deficit <= 0) break;
      const role = String(beat?.role || "STORY").toUpperCase();
      const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
      const source = byName.get(String(beat?.source_filename || ""));
      const sourceDuration = Number(source?.duration) || 0;
      const start = Number(beat?.source_start);
      const end = Number(beat?.source_end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || sourceDuration <= 0) continue;

      const room = Math.min(
        Math.max(0, bounds.max - (end - start)),
        Math.max(0, sourceDuration - end),
      );
      const add = Math.min(deficit, room);
      if (add > 0) {
        beat.source_end = Number((end + add).toFixed(3));
        deficit -= add;
      }
    }
  }

  return repaired;
}

function mapBeatIntent(value: any, role: string): AtlasBeatIntent {
  const allowed = [
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
  ] as const;
  const candidate = String(value || "").toUpperCase();
  if ((allowed as readonly string[]).includes(candidate)) return candidate as AtlasBeatIntent;
  if (role === "HOOK") return "HOOK_IMPACT";
  if (role === "PAYOFF") return "HERO";
  if (role === "CTA") return "CTA";
  return "ACTION";
}

function mapEditorialStrategy(beatIntent: string, role: string) {
  const mapping: Record<string, string> = {
    HOOK_IMPACT: "HOOK",
    PROBLEM: "PROBLEM",
    ACTION: "ACTION",
    PROOF: "PROOF",
    ESCALATION: "ESCALATION",
    TRANSFORMATION: "PAYOFF",
    HERO: "PAYOFF",
    CTA: "CTA",
    REACTION: "SETUP",
    BRIDGE: "BRIDGE",
    BREATH: "BREATH",
  };
  return mapping[beatIntent] || (role === "HOOK" ? "HOOK" : role === "PAYOFF" ? "PAYOFF" : role === "CTA" ? "CTA" : "ACTION");
}

function mapVisualStrategy(beatIntent: string, role: string, cropFocus: string) {
  if (role === "CTA") return "CTA";
  if (role === "HOOK") return "HERO";
  if (beatIntent === "PROOF") return "PROOF";
  if (beatIntent === "TRANSFORMATION") return "TRANSFORMATION";
  if (beatIntent === "HERO") return "HERO";
  if (beatIntent === "REACTION") return "REACTION";
  if (beatIntent === "ACTION" || beatIntent === "ESCALATION") return "ACTION";
  if (cropFocus === "PRODUCT") return "PRODUCT";
  if (cropFocus === "FACE") return "REACTION";
  return "DETAIL";
}

function mapFraming(cropFocus: string, role: string) {
  if (role === "CTA" || cropFocus === "PRODUCT") return "PRODUCT_HERO";
  if (cropFocus === "FACE") return "CLOSE";
  if (cropFocus === "ACTION") return "DETAIL";
  if (cropFocus === "TOP" || cropFocus === "BOTTOM") return "MEDIUM";
  return "MEDIUM";
}

function mapRelationship(beat: any, index: number, previousShotId?: string) {
  if (index === 0) return { relationship: "STANDALONE", relationshipTo: undefined };

  const cutOn = String(beat?.cut_on || "").toUpperCase();
  const previousId = String(previousShotId || "").trim();

  // Relationship targets MUST reference an actual shot id in this compiled
  // timeline. Never synthesize `beat-${index}` because the Director may emit
  // arbitrary shot ids and the V2 validator correctly rejects missing targets.
  if (!previousId) {
    return { relationship: "CONTINUATION", relationshipTo: undefined };
  }

  if (cutOn === "MOTION_MATCH") return { relationship: "MOTION_MATCH", relationshipTo: previousId };
  if (cutOn === "REVEAL") return { relationship: "REVEAL", relationshipTo: previousId };
  if (cutOn === "ACTION_PEAK") return { relationship: "ACTION_MATCH", relationshipTo: previousId };
  return { relationship: "CONTINUATION", relationshipTo: undefined };
}

function buildV2EditPlan(
  raw: any,
  timeline: any[],
  brief: any,
  master: any,
  analyses: any[],
  captions: any[],
  targetDuration: number,
): AtlasEditPlanV2 {
  const shots = timeline.map((beat: any, index: number) => {
    const role = String(beat?.role || "STORY").toUpperCase();
    const beatIntent = mapBeatIntent(beat?.beat_intent, role);
    const cropFocus = String(beat?.crop_focus || "CENTER").toUpperCase();
    const sourceStart = Number(beat?.source_start || 0);
    const sourceEnd = Number(beat?.source_end || sourceStart + 0.25);
    const shotDuration = Math.max(0.25, sourceEnd - sourceStart);
    const relationship = mapRelationship(beat, index, index > 0 ? String(timeline[index - 1]?.id || "") : undefined);
    const speed = clamp(Number(beat?.speed) || 1, 0.25, 3);
    const musicVolume = clamp(Number(beat?.music_volume) || 0, 0, 1);
    const sourceAudioVolume = clamp(Number(beat?.source_audio_volume) || 0, 0, 1);
    const textContent = String(beat?.text || "").trim();

    return {
      id: String(beat?.id || `beat-${index + 1}`),
      sourceFilename: String(beat?.source_filename || ""),
      role,
      beatIntent,
      purpose: String(beat?.purpose || "").trim(),
      cutReason: String(beat?.cut_reason || "").trim(),
      editorialScore: clamp(Number(beat?.editorial_score) || 0, 0, 100),
      timing: {
        sourceStart,
        sourceEnd,
        cutOn: (() => {
          const rawCutOn = String(beat?.cut_on || "NONE").toUpperCase();
          const map: Record<string, string> = {
            ACTION_PEAK: "ACTION",
            MOTION_MATCH: "MOTION",
            WORD_EMPHASIS: "WORD",
            MUSIC_BEAT: "MUSIC",
            REVEAL: "REVEAL",
            BREATH: "BREATH",
          };
          return map[rawCutOn] || "NONE";
        })(),
        microCut: Boolean(beat?.micro_cut),
      },
      transitionIn: String(beat?.transition_in || "CUT"),
      transitionOut: String(beat?.transition_out || "CUT"),
      motion: {
        type: String(beat?.motion || "STATIC"),
        zoomStart: clamp(Number(beat?.zoom_start) || 1, 1, 1.45),
        zoomEnd: clamp(Number(beat?.zoom_end) || 1, 1, 1.45),
        cropFocus: cropFocus === "CENTER" ? "CENTER" : cropFocus,
        anchorX: undefined,
        anchorY: undefined,
      },
      speed,
      speedCurve: normalizeSpeedCurve(beat?.speed_curve, speed),
      visual: {
        strategy: mapVisualStrategy(beatIntent, role, cropFocus),
        framing: mapFraming(cropFocus, role),
        colorTreatment: String(beat?.color_treatment || "NATURAL"),
        brightness: Number.isFinite(Number(beat?.brightness)) ? Number(beat.brightness) : undefined,
        contrast: Number.isFinite(Number(beat?.contrast)) ? Number(beat.contrast) : undefined,
        saturation: Number.isFinite(Number(beat?.saturation)) ? Number(beat.saturation) : undefined,
        blur: Number.isFinite(Number(beat?.blur)) ? Number(beat.blur) : undefined,
        reframe: { enabled: false },
      },
      relationship: relationship.relationship,
      relationshipTo: relationship.relationshipTo,
      editorialStrategy: mapEditorialStrategy(beatIntent, role),
      sourceMoment: {
        type: beat?.source_moment?.type ? String(beat.source_moment.type) : "SELECTED_WINDOW",
        start: Number.isFinite(Number(beat?.source_moment?.start)) ? Number(beat.source_moment.start) : sourceStart,
        end: Number.isFinite(Number(beat?.source_moment?.end)) ? Number(beat.source_moment.end) : sourceEnd,
        score: Number.isFinite(Number(beat?.source_moment?.score))
          ? clamp(Number(beat.source_moment.score) > 1 ? Number(beat.source_moment.score) / 100 : Number(beat.source_moment.score), 0, 1)
          : (Number.isFinite(Number(beat?.editorial_score)) ? clamp(Number(beat.editorial_score) / 100, 0, 1) : undefined),
      },
      hold: {
        enabled: false,
        duration: 0,
        at: 0,
        reason: "NONE",
      },
      ...(textContent
        ? {
            text: {
              content: textContent,
              style: String(beat?.text_style || "MINIMAL"),
              animation: String(beat?.text_animation || "NONE"),
              position: String(beat?.text_position || "CENTER"),
              emphasisWords: Array.isArray(beat?.emphasis_words) ? beat.emphasis_words.map(String) : [],
              duration: shotDuration,
              startAt: 0,
              endAt: shotDuration,
            },
          }
        : {}),
      audio: {
        sourceAudioVolume,
        musicVolume,
        musicCurve: normalizeMusicCurve(beat?.music_curve, musicVolume),
        sfx: Array.isArray(beat?.sfx) ? beat.sfx.map(String) : [],
        sfxEvents: deriveSfxEvents(beat?.sfx, beat?.sfx_events, shotDuration),
        voiceDuck: {
          enabled: false,
          amount: 0,
        },
      },
      decision: {
        confidence: clamp((Number(beat?.editorial_score) || 0) / 100, 0, 1),
        locked: role === "CTA",
        alternativeShotIds: [],
        rationale: String(beat?.cut_reason || beat?.purpose || "").trim() || undefined,
      },
    } as any;
  });

  const sourceAssets: AtlasSourceAsset[] = analyses
    .map((asset: any) => ({ filename: String(asset?.filename || ""), duration: Number(asset?.duration) || 0 }))
    .filter((asset) => asset.filename && asset.duration > 0);

  const plan: AtlasEditPlanV2 = {
    version: "ATLAS_EDIT_PLAN_V2",
    creative: {
      objective: String(brief?.objective || master?.objective || master?.goal || "").trim(),
      audience: String(brief?.target_audience || brief?.audience || master?.audience || "").trim(),
      tone: String(brief?.tone || master?.tone || "").trim(),
      platform: String(brief?.platform || master?.platform || "").trim(),
      aspectRatio: String(brief?.aspect_ratio || master?.aspect_ratio || "9:16"),
      retentionStrategy: String(brief?.retention_strategy || master?.retention_strategy || raw?.hook_strategy || "").trim(),
    },
    timeline: { shots },
    music: {
      enabled: Boolean(master?.music_enabled ?? true),
      volume: clamp(Number(master?.music_volume ?? 0.65), 0, 1),
      curve: normalizeMusicCurve(master?.music_curve, clamp(Number(master?.music_volume ?? 0.65), 0, 1)),
      beatGrid: Array.isArray(master?.beat_grid)
        ? master.beat_grid.map(Number).filter(Number.isFinite)
        : undefined,
    },
    voice: {
      mode: String(master?.voice_mode || brief?.voice_mode || "NONE"),
      script: String(master?.voice_script || brief?.voice_script || ""),
      priority: String(master?.voice_priority || "NORMAL") as "HIGH" | "NORMAL" | "LOW",
      wordTimings: Array.isArray(master?.word_timings)
        ? master.word_timings
            .map((x: any) => ({ word: String(x?.word || ""), start: Number(x?.start), end: Number(x?.end) }))
            .filter((x: any) => x.word && Number.isFinite(x.start) && Number.isFinite(x.end))
        : undefined,
    },
    captions: {
      enabled: captions.length > 0 || Boolean(brief?.captions_enabled),
      mode: String(brief?.caption_mode || "AUTO"),
      style: String(brief?.caption_style || "MINIMAL"),
      emphasisWords: Array.isArray(brief?.caption_emphasis_words) ? brief.caption_emphasis_words.map(String) : [],
    },
    cover: {
      enabled: Boolean(brief?.cover_enabled),
      shotId: brief?.cover_shot_id ? String(brief.cover_shot_id) : undefined,
      title: brief?.cover_title ? String(brief.cover_title) : undefined,
      subtitle: brief?.cover_subtitle ? String(brief.cover_subtitle) : undefined,
    },
    quality: {
      targetDurationSeconds: clamp(Number(targetDuration) || 15, 8, 60),
      minimumBeats: 7,
      maximumBeats: 12,
      requireCta: true,
      maxNonCutTransitions: 6,
      maxTextBeats: 3,
      maxAdjacentSameSource: 0,
    },
  };

  assertExecutableTimeline(plan, sourceAssets);
  return plan;
}


function ensureExecutableTimeline(
  input: any[],
  analyses: any[],
  targetDuration: number,
  momentCandidates: AtlasMomentCandidate[],
): any[] {
  const timeline = Array.isArray(input)
    ? input.map((x) => ({ ...x }))
    : [];

  if (!timeline.length || !analyses.length) return timeline;

  const target = clamp(Number(targetDuration) || 15, 8, 60);
  const minTotal = target * 0.90;

  const sourceByName = new Map(
    analyses
      .filter((x: any) => String(x?.filename || ""))
      .map((x: any) => [String(x.filename), x]),
  );

  const usedSources = new Set(
    timeline.map((x) => String(x?.source_filename || "")).filter(Boolean),
  );

  const durationForRole = (role: string) => {
    const key = String(role || "STORY").toUpperCase();
    return PACING_BOUNDS[key] || PACING_BOUNDS.STORY;
  };

  const chooseMoment = (source: any, role: string, intent: string) => {
    const candidates = momentCandidates
      .filter((m) => m.sourceFilename === String(source?.filename || ""))
      .sort((a, b) => {
        const intentScore = (m: AtlasMomentCandidate) =>
          String(m.type || "").toUpperCase() === String(intent || "").toUpperCase()
            ? 30
            : String(m.beatFit || "").toUpperCase() === String(intent || "").toUpperCase()
              ? 20
              : 0;
        return (b.score + intentScore(b)) - (a.score + intentScore(a));
      });

    const candidate = candidates[0];
    if (candidate) return candidate;

    const bounds = durationForRole(role);
    const duration = Math.max(0.25, Number(source?.duration) || 0.25);
    const suggestedStart = Number(source?.suggested_start);
    const suggestedEnd = Number(source?.suggested_end);
    let start = Number.isFinite(suggestedStart) ? suggestedStart : 0;
    let end = Number.isFinite(suggestedEnd) ? suggestedEnd : start + bounds.min;

    start = clamp(start, 0, Math.max(0, duration - 0.25));
    end = clamp(end, start + bounds.min, duration);
    if (end - start > bounds.max) end = Math.min(duration, start + bounds.max);
    if (end - start < bounds.min) {
      start = Math.max(0, end - bounds.min);
    }
  return {
  id: `fallback-${String(source?.filename || "source")}-${timeline.length + 1}`,
  sourceFilename: String(source?.filename || ""),
  type: role === "CTA" ? "HERO_FRAME" : role === "HOOK" ? "ACTION_PEAK" : "DETAIL",
  start,
  end,
  duration: end - start,
  score: Number(source?.score) || 0,
  confidence: 0.5,
  beatFit: [intent],
  signals: ["fallback"],
  rationale: "Fallback moment candidate generated because no stronger moment was available.",
} as AtlasMomentCandidate;
  };

  const makeText = (role: string) => {
    const r = String(role || "").toUpperCase();
    if (r === "HOOK") return "FRESH. PRECISE. PREMIUM.";
    if (r === "CTA") return "VISIT / ORDER TODAY";
    return "";
  };

  // Structural invariants first: one HOOK, one CTA, payoff presence.
  if (timeline.length) {
    timeline[0].role = "HOOK";
    timeline[0].beat_intent = "HOOK_IMPACT";
    if (!String(timeline[0].text || "").trim()) {
      timeline[0].text = makeText("HOOK");
      timeline[0].text_style = "HOOK";
      timeline[0].text_animation = "POP";
      timeline[0].text_position = "CENTER";
    }

    const ctaIndexes = timeline
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => String(x?.role || "").toUpperCase() === "CTA")
      .map(({ i }) => i);

    if (ctaIndexes.length === 0) {
      const last = timeline[timeline.length - 1];
      last.role = "CTA";
      last.beat_intent = "CTA";
      last.text = String(last.text || "").trim() || makeText("CTA");
      last.text_style = "CTA";
      last.text_animation = "FADE";
      last.text_position = "CENTER";
    } else if (ctaIndexes.length > 1) {
      const keep = ctaIndexes[ctaIndexes.length - 1];
      timeline.forEach((x, i) => {
        if (i !== keep && String(x?.role || "").toUpperCase() === "CTA") {
          x.role = "STORY";
          x.beat_intent = "ACTION";
          if (String(x.text || "").trim() && x.text_style === "CTA") {
            x.text_style = "MINIMAL";
          }
        }
      });
    }

    const ctaIndex = timeline.findIndex(
      (x) => String(x?.role || "").toUpperCase() === "CTA",
    );
    if (ctaIndex >= 0 && ctaIndex !== timeline.length - 1) {
      const [cta] = timeline.splice(ctaIndex, 1);
      timeline.push(cta);
    }
  }

  // Ensure a real payoff/hero exists among non-CTA beats.
  const hasPayoff = timeline.some(
    (x) =>
      String(x?.role || "").toUpperCase() === "PAYOFF" ||
      ["TRANSFORMATION", "HERO"].includes(
        String(x?.beat_intent || "").toUpperCase(),
      ),
  );
  if (!hasPayoff && timeline.length > 1) {
    const candidate = timeline
      .slice(0, -1)
      .sort((a, b) => Number(b?.editorial_score || 0) - Number(a?.editorial_score || 0))[0];
    if (candidate) {
      candidate.role = "PAYOFF";
      candidate.beat_intent = "HERO";
    }
  }

  // Normalize current beat durations to their role maxima before adding material.
  for (const beat of timeline) {
    const role = String(beat?.role || "STORY").toUpperCase();
    const bounds = durationForRole(role);
    const source = sourceByName.get(String(beat?.source_filename || ""));
    const sourceDuration = Number(source?.duration) || Number(beat?.source_end || 0);
    let start = Number(beat?.source_start);
    let end = Number(beat?.source_end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    start = clamp(start, 0, Math.max(0, sourceDuration - 0.25));
    end = clamp(end, start + bounds.min, sourceDuration);
    if (end - start > bounds.max) end = Math.min(sourceDuration, start + bounds.max);
    if (end - start < bounds.min) {
      const needed = bounds.min - (end - start);
      const after = Math.min(needed, Math.max(0, sourceDuration - end));
      end += after;
      if (end - start < bounds.min) {
        const before = Math.min(bounds.min - (end - start), Math.max(0, start));
        start -= before;
      }
    }

    beat.source_start = Number(start.toFixed(3));
    beat.source_end = Number(Math.min(sourceDuration || end, end).toFixed(3));
  }

  const totalDuration = () =>
    timeline.reduce(
      (sum, beat) =>
        sum + Math.max(
          0,
          Number(beat?.source_end || 0) - Number(beat?.source_start || 0),
        ),
      0,
    );

  // Recovery stage A: add unused real source files until duration is healthy.
  const rankedSources = analyses
    .filter((x: any) => String(x?.filename || "") && Number(x?.duration || 0) >= 0.75)
    .sort((a: any, b: any) => Number(b?.score || 0) - Number(a?.score || 0));

  for (const source of rankedSources) {
    if (totalDuration() >= minTotal) break;
    const filename = String(source.filename);
    if (usedSources.has(filename)) continue;

    const insertBeforeCta = Math.max(0, timeline.findIndex(
      (x) => String(x?.role || "").toUpperCase() === "CTA",
    ));
    const index = insertBeforeCta >= 0 ? insertBeforeCta : timeline.length;
    const role = timeline.length < 7
      ? (timeline.length === 5 ? "PAYOFF" : "STORY")
      : "STORY";
    const intent = role === "PAYOFF"
      ? "HERO"
      : (timeline.length >= 6 ? "ESCALATION" : "ACTION");

    const moment = chooseMoment(source, role, intent);
    const bounds = durationForRole(role);
    let start = clamp(Number(moment.start) || 0, 0, Math.max(0, Number(source.duration) - 0.25));
    let end = clamp(Number(moment.end) || (start + bounds.min), start + bounds.min, Number(source.duration));
    if (end - start > bounds.max) end = Math.min(Number(source.duration), start + bounds.max);
    if (end - start < bounds.min) {
      end = Math.min(Number(source.duration), start + bounds.min);
      start = Math.max(0, end - bounds.min);
    }

    timeline.splice(index, 0, {
      id: `recovery-${timeline.length + 1}`,
      source_filename: filename,
      source_start: Number(start.toFixed(3)),
      source_end: Number(end.toFixed(3)),
      moment_candidate_id: moment.id,
      source_moment: momentToSourceMoment(moment),
      role,
      purpose: role === "PAYOFF" ? "Build the strongest final hero/payoff." : "Introduce new visual information.",
      cut_reason: "Deterministic duration/source recovery using real unused footage.",
      transition_in: "CUT",
      transition_out: "CUT",
      motion: role === "PAYOFF" ? "PUSH_IN" : "DRIFT",
      zoom_start: 1,
      zoom_end: role === "PAYOFF" ? 1.08 : 1.04,
      speed: 1,
      text: "",
      text_style: "NONE",
      text_animation: "NONE",
      text_position: "CENTER",
      emphasis_words: [],
      sfx: [],
      sfx_events: [],
      source_audio_volume: 0,
      music_volume: 0.65,
      color_treatment: role === "PAYOFF" ? "CLEAN_PREMIUM" : "NATURAL",
      crop_focus: "CENTER",
      editorial_score: Number(source?.score || 0),
      beat_intent: intent,
      cut_on: intent === "ESCALATION" ? "ACTION_PEAK" : "ACTION_PEAK",
    });

    usedSources.add(filename);
  }

  // Recovery stage B: extend non-CTA beats inside their real source windows.
  if (totalDuration() < minTotal) {
    for (let pass = 0; pass < 3 && totalDuration() < minTotal; pass++) {
      for (const beat of timeline) {
        if (totalDuration() >= minTotal) break;
        if (String(beat?.role || "").toUpperCase() === "CTA") continue;

        const role = String(beat?.role || "STORY").toUpperCase();
        const bounds = durationForRole(role);
        const source = sourceByName.get(String(beat?.source_filename || ""));
        const sourceDuration = Number(source?.duration) || Number(beat?.source_end || 0);
        const start = Number(beat?.source_start);
        const end = Number(beat?.source_end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || sourceDuration <= 0) continue;

        const current = end - start;
        const maxExpandable = Math.max(0, bounds.max - current);
        const roomAfter = Math.max(0, sourceDuration - end);
        const roomBefore = Math.max(0, start);
        const need = Math.min(minTotal - totalDuration(), maxExpandable);

        const addAfter = Math.min(need, roomAfter);
        if (addAfter > 0) {
          beat.source_end = Number((end + addAfter).toFixed(3));
        } else if (need > 0) {
          const addBefore = Math.min(need, roomBefore);
          if (addBefore > 0) {
            beat.source_start = Number((start - addBefore).toFixed(3));
          }
        }
      }
    }
  }

  // Action-based cut enforcement: when a beat is backed by a real temporal
  // moment signal, place the outgoing cut immediately after the visual event
  // instead of letting the source window drift to an arbitrary clip boundary.
  // This is deliberately deterministic so the renderer receives an executable
  // cut point rather than a stylistic suggestion.
  for (const beat of timeline) {
    const role = String(beat?.role || "STORY").toUpperCase();
    if (role === "CTA") continue;

    const candidate = momentCandidates.find(
      (m) => m.id === String(beat?.moment_candidate_id || ""),
    );
    if (!candidate) continue;

    const type = String(candidate.type || "").toUpperCase();
    const hasTemporalSignal = Array.isArray(candidate.signals)
      && candidate.signals.some((signal) =>
        /_signal$|peak|reveal|transform/i.test(String(signal)),
      );
    if (!hasTemporalSignal) continue;

    const actionLike = ["ACTION_PEAK", "MOTION_PEAK"].includes(type);
    const revealLike = ["REVEAL", "TRANSFORMATION"].includes(type);
    if (!actionLike && !revealLike) continue;

    const source = sourceByName.get(String(beat?.source_filename || ""));
    const sourceDuration = Number(source?.duration) || Number(beat?.source_end || 0);
    if (sourceDuration <= 0) continue;

    const center = (Number(candidate.start) + Number(candidate.end)) / 2;
    const currentStart = Number(beat?.source_start);
    const currentEnd = Number(beat?.source_end);
    if (!Number.isFinite(center) || !Number.isFinite(currentStart) || !Number.isFinite(currentEnd)) continue;

    const currentDuration = Math.max(0.25, currentEnd - currentStart);
    const leadIn = actionLike ? Math.min(0.65, Math.max(0.45, currentDuration * 0.72)) : Math.min(0.8, Math.max(0.5, currentDuration * 0.7));
    const tail = actionLike ? 0.12 : 0.18;
    const end = clamp(center + tail, 0, sourceDuration);
    const start = clamp(end - leadIn, 0, Math.max(0, sourceDuration - 0.25));

    if (end - start < 0.45) continue;

    beat.source_start = Number(start.toFixed(3));
    beat.source_end = Number(end.toFixed(3));
    beat.cut_on = actionLike ? "ACTION_PEAK" : "REVEAL";
    beat.cut_reason = actionLike
      ? `Cut immediately after temporal ${type.toLowerCase()} at ${center.toFixed(2)}s.`
      : `Cut immediately after ${type.toLowerCase()} at ${center.toFixed(2)}s.`;
  }

  // Final pacing pass: action-based cuts can shorten a beat around the event,
  // so re-apply role bounds after the cut point is chosen. This keeps the
  // action moment while preventing dead holds or rushed beats.
  for (const beat of timeline) {
    const role = String(beat?.role || "STORY").toUpperCase();
    const bounds = durationForRole(role);
    const source = sourceByName.get(String(beat?.source_filename || ""));
    const sourceDuration = Number(source?.duration) || 0;
    let start = Number(beat?.source_start);
    let end = Number(beat?.source_end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || sourceDuration <= 0) continue;

    let duration = end - start;
    if (duration > bounds.max) {
      // Keep the visual end/cut point and trim the least useful lead-in first.
      start = end - bounds.max;
      duration = bounds.max;
    }

    if (duration < bounds.min) {
      const need = bounds.min - duration;
      const roomBefore = Math.max(0, start);
      const addBefore = Math.min(need, roomBefore);
      start -= addBefore;
      duration += addBefore;

      if (duration < bounds.min) {
        const roomAfter = Math.max(0, sourceDuration - end);
        const addAfter = Math.min(bounds.min - duration, roomAfter);
        end += addAfter;
        duration += addAfter;
      }
    }

    beat.source_start = Number(Math.max(0, start).toFixed(3));
    beat.source_end = Number(Math.min(sourceDuration, end).toFixed(3));
  }

  // Final deterministic ordering: CTA remains last and no adjacent duplicate source.
  const ctaIndex = timeline.findIndex(
    (x) => String(x?.role || "").toUpperCase() === "CTA",
  );
  if (ctaIndex >= 0 && ctaIndex !== timeline.length - 1) {
    const [cta] = timeline.splice(ctaIndex, 1);
    timeline.push(cta);
  }

  return repairAdjacentSourceDuplicates(timeline);
}

export async function POST(request: Request) {
  try {
    if (!openai || !apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing." },
        { status: 500 },
      );
    }

    const body = await request.json();

    const brief = body?.creative_brief || {};
    const master = body?.master_plan || {};
    const analyses = Array.isArray(body?.clips) ? body.clips : [];
    const matches = Array.isArray(body?.footage_matches) ? body.footage_matches : [];
    const captions = Array.isArray(body?.captions) ? body.captions : [];
    const review = body?.review || null;

    const targetDuration = Number(
      master?.target_duration_seconds ||
      master?.total_duration_seconds ||
      brief?.duration ||
      15,
    );

    const momentCandidates = generateMomentCandidatesForSources(analyses, {
      minDuration: 0.35,
      maxDuration: 2.4,
      maxCandidatesPerSource: 10,
    });

    const momentCatalog = momentCandidates
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 120)
      .map((candidate) => ({
        id: candidate.id,
        source: candidate.sourceFilename,
        type: candidate.type,
        start: candidate.start,
        end: candidate.end,
        score: candidate.score,
        confidence: candidate.confidence,
        beatFit: candidate.beatFit,
      }));

    const revisionContext = review
      ? `
THIS IS A REVIEW-DRIVEN V2 PASS.

The previous rendered cut was reviewed by a senior editor.
Do not blindly preserve the old timeline.

REVIEW:
${JSON.stringify(review, null, 2)}

Fix the actual problems identified by the reviewer.
If the reviewer says the hook is weak, change the first visual beat.
If pacing is flat, change beat durations and source moments.
If shots are repetitive, change source/order/framing.
If the hero/CTA is weak, move the strongest available final visual to the end.
If typography or transitions are weak, change those dimensions too.

The new timeline must be materially different where the review requires it.
`
      : `
THIS IS THE FIRST EDIT PASS.
Build the strongest publishable timeline from the available footage.
`;

    const prompt = `You are ATLAS AI EDIT DIRECTOR V3 - a senior commercial editor, trailer editor and short-form retention specialist.

Your output is the executable creative timeline. The renderer will obey it literally. Do not produce a generic montage.

ARCHITECTURE
- Master Director = WHY / business story.
- Vision = WHAT exists in the real footage.
- You = HOW the edit feels: exact source windows, rhythm, cuts, motion, typography, sound cues and grade.
- Renderer = deterministic execution only.

QUALITY TARGET
The user should watch the finished Reel and immediately think: "This was edited by a real professional."

EDITORIAL RULES
1. HOOK: first 0.0-0.9s must be the strongest visual moment. Prefer action, texture, contrast, transformation or an unusual detail. Never spend the opening establishing the scene unless it is genuinely exceptional.
2. RHYTHM: for ~15s use 7-10 meaningful beats when footage supports it. Typical beat 0.65-1.9s. Hero 1.5-2.6s. CTA 2.0-3.2s. Do not stretch weak footage to hit duration.
3. CUT ON SOMETHING: every cut should be motivated by ACTION_PEAK, MOTION_MATCH, WORD_EMPHASIS, MUSIC_BEAT, REVEAL or BREATH. Do not cut merely because a clip ended.
4. SEQUENCE: build escalation. A strong default for service footage is HOOK -> PROBLEM -> ACTION -> PROOF -> ESCALATION -> TRANSFORMATION -> HERO -> CTA, but rebuild when the real footage demands it.
5. SOURCE SELECTION:
Choose the strongest usable moment from the real footage for each beat.

SOURCE DIVERSITY IS A HARD EDITORIAL REQUIREMENT:
- Prefer ONE source filename per beat.
- Do NOT reuse the same source filename within the same 15s Reel when enough distinct usable sources exist.
- If there are 7+ usable sources, use at least 7 different source filenames across 7-10 beats.
- If there are 5-6 usable sources, use each source at least once before reusing any source.
- A source may only be reused when there are not enough distinct usable sources.
- Never reuse the same visual action, composition, food arrangement or moment simply to fill duration.
- Never create multiple beats from different windows of the same source just to increase beat count.
- Never invent timestamps.
- Never repeat the same exact source window.
- Every beat must introduce a meaningfully different visual idea, composition, scale, subject or action.
6. VISUAL VARIETY: deliberately alternate composition, scale and motion. Do not make every beat a push-in. Use static beauty shots when they are stronger than motion.
7. MOTION: zoom_start/zoom_end are intentional camera decisions. PUSH_IN should normally increase scale, PULL_OUT decrease, pans should be reserved for directional movement.
8. TRANSITIONS: CUT is dominant. Use MATCH/WHIP/PUNCH/FLASH/ZOOM only when the visual handoff earns it. Use transition treatment on as many edges as the footage earns, with a hard maximum of 6 non-CUT transitions in a 15s cut. Prefer varied treatments and keep clean CUTs where a transition would be weaker.
9. TEXT: typography is a designed hierarchy. Usually text on HOOK + one proof/value beat + CTA, not every shot. Keep it short enough to read at phone speed. Never invent claims.
10. AUDIO: if source audio contains useful physical sound, preserve it selectively. Voice wins. Music supports. SFX should land on visible actions or editorial impacts.
11. COLOR: choose a per-shot color_treatment such as NATURAL, CLEAN_PREMIUM, CRISP_DETAIL, DARK_LUXURY, PUNCHY, WARM, or COOL. The grade must support the material; do not make every shot look identical.
12. CTA: when the brief has a booking/purchase/contact objective, you MUST output exactly ONE beat with role=CTA. It MUST be the final timeline beat and use the strongest clean hero frame with enough reading time. Never omit CTA, never label PAYOFF as CTA, and never finish on PAYOFF.
13. BEAT COUNT: for a ~15s reel, output 7-10 distinct executable beats. If a candidate is weak, replace it with another real source window; do not reduce the timeline to 5 beats.
14. NO TEMPLATE FEEL:
Every beat must have a distinct editorial job AND a distinct visual idea.
Do not solve a 15s timeline by slicing 2-3 clips into many similar beats.
If two candidate beats look visually similar, keep only the stronger one and select another source.
SFX VOCABULARY
HOOK_IMPACT, WHOOSH, WATER, FOAM, WIPE, MACHINE, REVEAL_IMPACT, CTA_HIT, CLICK, POP, NONE. Use 0-2 cues per beat.

REVISION RULE
If REVIEW is present, treat it as a real editorial note from a senior reviewer. Fix the specific failure, not just the metadata. Prefer a materially better first second, stronger action peaks, better rhythm, cleaner typography and stronger payoff over cosmetic changes. Never make a revision merely different; make it better.

${revisionContext}

MOMENT CANDIDATES (choose one moment_candidate_id per beat):
${JSON.stringify(momentCatalog, null, 2)}

MOMENT SELECTION RULES:
- Every beat MUST select one real moment_candidate_id from the catalog.
- Prefer ACTION_PEAK for action/hook beats, REVEAL or TRANSFORMATION for transformations, HERO_FRAME for hero/CTA, REACTION for reactions, and DETAIL for proof/details.
- The selected candidate MUST belong to the same source_filename used by the beat.
- source_start/source_end should stay consistent with the selected moment. The normalizer will bind them to the candidate window.
- Never invent a candidate id, timestamp, source filename, or moment type.

CREATIVE BRIEF:
${JSON.stringify(brief, null, 2)}

MASTER DIRECTOR PLAN:
${JSON.stringify(master, null, 2)}

VISION FOOTAGE:
${JSON.stringify(analyses, null, 2)}

FOOTAGE MATCHES:
${JSON.stringify(matches, null, 2)}

CAPTIONS:
${JSON.stringify(captions, null, 2)}

Before returning JSON, internally verify:
- first beat is genuinely the strongest hook
- target 7-10 beats for a usable ~15s source set when footage supports it
- 6 strong beats are an acceptable fallback when forcing a 7th would require weak or repetitive footage
- exactly one CTA beat exists and it is the final beat
- no adjacent duplicate source
- no exact repeated source window
- at least 4 unique source files when available
- CTA is last when required
- total visual duration is within 90-103% of target when enough footage exists
- at least 3 distinct motion treatments when footage supports it
- no more than 6 non-CUT transitions; use fewer when the edge does not earn a transition
- text is sparse and readable
- SFX are motivated by visible action
- no invented claims
- maximize unique source filenames before any source reuse
- if 7+ usable sources exist, use 7+ unique source filenames
- never use multiple beats from the same source when another strong unused source can perform the job
- each consecutive beat must materially change visual information

Return ONLY JSON matching the schema.`;

    const createPlan = async (extraInstruction = "") => {
      const response = await openai.responses.create({
        model: "gpt-5.4-mini",
        store: false,
        input: [{
          role: "user",
          content: `${prompt}${extraInstruction ? `\n\nTARGETED REGENERATION INSTRUCTION:\n${extraInstruction}` : ""}`,
        }],
        text: {
          format: {
            type: "json_schema",
            name: "atlas_ai_edit_director_v2",
            strict: true,
            schema,
          },
        },
      });

      if (!response.output_text) {
        throw new Error("AI Edit Director returned no plan.");
      }

      return JSON.parse(response.output_text);
    };

    let raw: any;
    let timeline: any[];
    let decisionCandidate: AtlasEditCandidate | null = null;
    let bestCutCandidate: AtlasBestCutCandidate | null = null;

    const normalizeRawTimeline = (plan: any) =>
      ensureExecutableTimeline(
        normalizeTimeline(
          Array.isArray(plan?.timeline) ? plan.timeline : [],
          analyses,
          targetDuration,
          momentCandidates,
        ),
        analyses,
        targetDuration,
        momentCandidates,
      );

    // Best-Cut Search pass: ask for several genuinely different editorial strategies,
    // optimize each against moment candidates, then select the strongest full timeline.
    const variantInstructions = [
      "VARIANT A — IMPACT: prioritize an aggressive first second, action peaks, rapid escalation and strong visual contrast. Keep the story coherent.",
      "VARIANT B — NARRATIVE: prioritize clear problem→action→proof→transformation storytelling, with restrained transitions and a satisfying payoff.",
      "VARIANT C — PREMIUM: prioritize polished commercial pacing, hero framing, elegant visual variety, sparse typography and a high-end final CTA.",
    ];

    const rawVariants = await Promise.all(
      variantInstructions.map((instruction) => createPlan(instruction)),
    );

    const optimizedVariants = rawVariants.map((variant) => {
      const decision = searchBestEditCandidate(
        Array.isArray(variant?.timeline) ? variant.timeline : [],
        momentCandidates,
        targetDuration,
        {
          beamWidth: 8,
          candidatesPerBeat: 5,
          maxSourceReuse: 2,
        },
      );
      return decision.timeline;
    });

    bestCutCandidate = searchBestCut(optimizedVariants, {
      maxCandidates: optimizedVariants.length,
      targetDuration,
    });

    const selectedVariantIndex = optimizedVariants.findIndex(
      (candidate) => candidate === bestCutCandidate?.timeline,
    );

    const selectedRaw = rawVariants[Math.max(0, selectedVariantIndex)];
    decisionCandidate = searchBestEditCandidate(
      Array.isArray(selectedRaw?.timeline) ? selectedRaw.timeline : [],
      momentCandidates,
      targetDuration,
      {
        beamWidth: 8,
        candidatesPerBeat: 5,
        maxSourceReuse: 2,
      },
    );

    raw = {
      ...selectedRaw,
      timeline: bestCutCandidate.timeline,
    };

    timeline = normalizeRawTimeline(raw);
    // STORY-FIRST SOURCE PASS: narrative job first, then moment-window refinement.
    timeline = assignNarrativeSources(timeline, analyses, momentCandidates);
    // Premium V2 refinement: narrative intent, action-anchored cuts and role-aware pacing.
    timeline = refineNarrativePacingAndAction(
      timeline,
      analyses,
      momentCandidates,
      targetDuration,
    );

    const checkContracts = (candidate: any[]) => {
      const unique = new Set(candidate.map((x) => String(x.source_filename))).size;
      const pacing = getPacingViolations(candidate, targetDuration);
      const editorial = getEditorialViolations(candidate, analyses, brief);
      const diversityTarget = Math.min(7, analyses.length);
      const diversityFailed = analyses.length >= 7 && unique < diversityTarget;
      return {
        unique,
        diversityTarget,
        diversityFailed,
        pacing,
        editorial,
        failed:
          diversityFailed ||
          pacing.violations.length > 0 ||
          editorial.violations.length > 0,
      };
    };

// HARD EDITORIAL CONTRACT:
// Failed contracts trigger bounded repair attempts.
// The AI is instructed to preserve passing beats and repair only
// the dimensions that actually failed.
let contract = checkContracts(timeline);

const MAX_REPAIR_ATTEMPTS = 3;

for (
  let repairAttempt = 1;
  contract.failed && repairAttempt <= MAX_REPAIR_ATTEMPTS;
  repairAttempt++
) {
  const reasons = [
    contract.diversityFailed
      ? `source diversity is ${contract.unique}/${contract.diversityTarget}; replace duplicate-source non-CTA beats with unused real source files where possible`
      : "",
    contract.pacing.violations.length
      ? `pacing violations: ${contract.pacing.violations.join("; ")}`
      : "",
    contract.editorial.violations.length
      ? `editorial violations: ${contract.editorial.violations.join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  console.warn(
    `[ATLAS EDIT DIRECTOR] bounded editorial repair ${repairAttempt}/${MAX_REPAIR_ATTEMPTS} | ${reasons}`,
  );

  raw = await createPlan(`
EDITORIAL REPAIR ATTEMPT ${repairAttempt}/${MAX_REPAIR_ATTEMPTS}

The previous timeline failed the hard editorial contract.

IMPORTANT:
- DO NOT redesign the entire edit.
- DO NOT randomly regenerate passing beats.
- PRESERVE every beat that already satisfies the contract.
- Repair ONLY the beats/dimensions identified by the violations below.
- Keep the same overall editorial intent and story structure.
- Keep exactly one CTA and keep it as the final beat.
- Never invent source filenames or timestamps.
- Never create duplicate source windows.
- Never sacrifice a passing constraint in order to fix another constraint.

FAILED CONTRACTS:
${reasons}

HARD PACING LIMITS:
- HOOK: 0.80-1.35s
- STORY: 0.65-1.65s
- PAYOFF: 1.40-2.40s
- CTA: 1.35-1.90s

HARD EDITORIAL LIMITS:
- maximum 3 text beats
- exactly 1 CTA
- CTA must be final
- at least 1 PAYOFF/HERO/TRANSFORMATION
- at least 1 ESCALATION when there are 7+ beats
- at least 3 distinct motion treatments when enough footage exists
- maximum 6 non-CUT transitions
- consecutive beats must not be visually/editorially redundant
- use distinct source filenames when available

REPAIR STRATEGY:
1. Identify the exact beats causing the reported violations.
2. Preserve all unaffected beats exactly unless changing them is strictly necessary.
3. For pacing violations, adjust ONLY the affected source_start/source_end.
4. For text density, remove text from the weakest affected text beats; never remove HOOK or CTA text.
5. For motion variety, change motion on suitable non-CTA beats only.
6. For source diversity, replace only duplicate-source beats when an unused real source exists.
7. For CTA duration, keep CTA between 1.35s and 1.90s. NEVER output a CTA longer than 1.90s.
8. After repair, internally verify every hard constraint before returning JSON.

Return the repaired complete timeline matching the schema.
`);
  
  timeline = normalizeRawTimeline(raw);
  contract = checkContracts(timeline);

  if (!contract.failed) {
    console.warn(
      `[ATLAS EDIT DIRECTOR] editorial contract passed after bounded repair ${repairAttempt}/${MAX_REPAIR_ATTEMPTS}`,
    );
    break;
  }
}

// Final safety-net: deterministic mechanical repair.
// This never replaces the AI's creative decisions unless necessary to satisfy
// an already-defined hard contract.
if (contract.failed) {
  const repaired = repairEditorialContract(
    timeline,
    analyses,
    targetDuration,
  );

  const repairedContract = checkContracts(repaired);

  if (!repairedContract.failed) {
    console.warn(
      `[ATLAS EDIT DIRECTOR] editorial contract mechanically repaired | before=${contract.pacing.total.toFixed(2)}s | after=${repairedContract.pacing.total.toFixed(2)}s | text=${repaired.filter((x) => String(x?.text || "").trim()).length}`,
    );

    timeline = repaired;
    contract = repairedContract;
  }
}

contract = checkContracts(timeline);

if (contract.failed) {
  console.warn(
    `[ATLAS EDIT DIRECTOR] bounded repairs did not fully satisfy contract; continuing to final deterministic normalizer | ${[
      contract.diversityFailed
        ? `source diversity ${contract.unique}/${contract.diversityTarget}`
        : "",
      ...contract.pacing.violations,
      ...contract.editorial.violations,
    ].filter(Boolean).join(" | ")}`,
  );
}

// FINAL PREMIUM V3 PASS: re-apply narrative/action/pacing after any AI repair.
// The repair model may rewrite source windows, so the deterministic editorial
// layer must have the final word before the executable V2 plan is built.
timeline = refineNarrativePacingAndAction(
  timeline,
  analyses,
  momentCandidates,
  targetDuration,
);
// V26 IMMUTABLE COMMERCIAL EXECUTION LOCK
// Final authority: no later deterministic pass is allowed to replace the CTA
// wording or its normalized source moment after this point.
if (timeline.length) {
  const foodBriefV26 = `${JSON.stringify(brief || {})} ${JSON.stringify(master || {})} ${JSON.stringify(raw || {})}`;
  const isFoodCommercialV26 = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/i.test(foodBriefV26);
  if (isFoodCommercialV26) {
    const ctaV26 = timeline[timeline.length - 1];
    ctaV26.role = "CTA";
    ctaV26.beat_intent = "CTA";
    ctaV26.text_style = "CTA";
    ctaV26.text_animation = "FADE";
    ctaV26.text_position = "CENTER";
    ctaV26.crop_focus = "PRODUCT";
    ctaV26.cut_on = "REVEAL";

    const b: any = brief || {}; const m: any = master || {}; const r: any = raw || {};
    const brandCandidates = [
      b?.brand_name, b?.brand, b?.business_name, b?.business, b?.restaurant_name, b?.client_name,
      m?.brand_name, m?.brand, m?.business_name, m?.business, m?.restaurant_name, m?.client_name,
      r?.brand_name, r?.brand, r?.business_name, r?.business, r?.restaurant_name, r?.client_name,
      body?.brand_name, body?.brand, body?.business_name, body?.business, body?.restaurant_name, body?.client_name,
    ].find((v: any) => typeof v === "string" && v.trim());
    const titleCandidatesV26 = [String(b?.title || ""), String(m?.title || ""), String(r?.title || ""), String(body?.title || "")];
    const titleBrandV26 = titleCandidatesV26.map((t) => t.includes("—") ? t.split("—")[0].trim() : t.includes(" - ") ? t.split(" - ")[0].trim() : "").find(Boolean) || "";
    const finalBrandV26 = String(brandCandidates || titleBrandV26 || "").trim();
    ctaV26.text = finalBrandV26 ? `${finalBrandV26.toUpperCase()}\nVISIT TONIGHT` : "VISIT TONIGHT";
    ctaV26.emphasis_words = ["VISIT TONIGHT"];

    const sourceV26 = (analyses || []).find((x: any) => String(x?.filename || "") === String(ctaV26.source_filename || ""));
    const sourceDurationV26 = Math.max(0.25, Number(sourceV26?.duration) || Number(ctaV26.source_end) || 0.25);
    let wsV26 = clamp(Number(ctaV26.source_start) || 0, 0, Math.max(0, sourceDurationV26 - 0.25));
    let weV26 = Number(ctaV26.source_end);
    if (!Number.isFinite(weV26)) weV26 = Math.min(sourceDurationV26, wsV26 + 1.75);
    weV26 = clamp(weV26, wsV26 + 0.25, sourceDurationV26);
    ctaV26.source_start = Number(wsV26.toFixed(3));
    ctaV26.source_end = Number(weV26.toFixed(3));
    ctaV26.source_moment = {
      ...(ctaV26.source_moment && typeof ctaV26.source_moment === "object" ? ctaV26.source_moment : {}),
      start: Number(clamp(Number(ctaV26?.source_moment?.start) || wsV26, wsV26, weV26).toFixed(3)),
      end: Number(clamp(Number(ctaV26?.source_moment?.end) || weV26, wsV26, weV26).toFixed(3)),
    };
    console.warn(`[ATLAS EDIT DIRECTOR] V26 CTA LOCK | brand=${finalBrandV26 || "NONE"} | source=${ctaV26.source_filename} | window=${ctaV26.source_start}-${ctaV26.source_end}`);
  }
}


// V27 IMMUTABLE COMMERCIAL LANDING
// Final authority: after ALL source, diversity, typography, pacing and moment
// normalization passes, a food-commercial CTA may only land on a clean finished
// product/hero source. This deliberately runs immediately before validation so
// no later repair can move the CTA back onto active preparation footage.
{
  const foodBriefV27 = `${JSON.stringify(brief || {})} ${JSON.stringify(master || {})}`;
  const isFoodCommercialV27 = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/i.test(foodBriefV27);

  if (isFoodCommercialV27 && timeline.length >= 2 && Array.isArray(analyses) && analyses.length) {
    const sourceTextV27 = (source: any) => [
      source?.shot_type, source?.shotType, source?.recommended_use,
      source?.reason, source?.strengths, source?.problems, source?.description,
      source?.summary, source?.subject, source?.action, source?.composition,
    ].flatMap((v: any) => Array.isArray(v) ? v : [v])
      .map((v: any) => String(v || '').toLowerCase()).join(' ');

    const scoreLandingV27 = (source: any) => {
      const t = sourceTextV27(source);
      const v = classifyCommercialVisual(source);
      let score = Number(source?.score || 0) * 3;

      // Finished-product evidence dominates generic hook/hero language.
      if (/(three plated|plated dishes|plated sushi|finished dish|final dish|completed dish|food showcase|signature dish|dish reveal|hero plating|plated hero|product reveal|beauty shot|menu hero|served presentation)/i.test(t)) score += 140;
      if (/(plated|finished|final dish|completed|served|presentation|platter|plate)/i.test(t)) score += 45;
      if (/(clean|minimal marble|top-down|overhead|sharp image|food is clearly visible)/i.test(t)) score += 20;

      // Active preparation and human reaction are disqualifying tendencies.
      score -= v.action * 14;
      score -= v.human * 12;
      if (/(placing fresh salmon|placing slices|rolling|cutting|slicing|knife|prep|preparing|cooking|chef hands|hands placing|active preparation|eating|bite|mouth|reaction)/i.test(t)) score -= 120;
      if (v.family === 'ACTION') score -= 100;
      if (v.family === 'HUMAN') score -= 100;

      return score;
    };

    const rankedV27 = analyses
      .filter((x: any) => String(x?.filename || '') && Number(x?.duration || 0) >= 0.75)
      .map((source: any) => ({ source, score: scoreLandingV27(source) }))
      .sort((a: any, b: any) => b.score - a.score);

    // Require actual finished-product evidence; never fall back to a generic
    // high-scoring action clip merely because it scored well as a hook.
    const bestV27 = rankedV27.find(({ source }: any) => {
      const t = sourceTextV27(source);
      const v = classifyCommercialVisual(source);
      return /(plated|finished dish|final dish|completed dish|food showcase|signature dish|dish reveal|hero plating|plated hero|product reveal|beauty shot|menu hero|served|presentation|platter)/i.test(t)
        && v.action < 8
        && v.human < 8;
    })?.source;

    const ctaV27 = timeline[timeline.length - 1];
    if (bestV27 && ctaV27) {
      const duration = Math.max(0.75, Number(bestV27.duration) || 0.75);
      const bounds = PACING_BOUNDS.CTA;
      const preferredStart = Number(bestV27.suggested_start);
      const preferredEnd = Number(bestV27.suggested_end);
      let start = Number.isFinite(preferredStart) ? preferredStart : 0;
      let end = Number.isFinite(preferredEnd) ? preferredEnd : start + bounds.max;

      start = clamp(start, 0, Math.max(0, duration - bounds.min));
      end = Math.min(duration, Math.max(start + bounds.min, end));
      if (end - start > bounds.max) end = start + bounds.max;
      if (end > duration) {
        end = duration;
        start = Math.max(0, end - bounds.max);
      }

      ctaV27.source_filename = String(bestV27.filename);
      ctaV27.source_start = Number(start.toFixed(3));
      ctaV27.source_end = Number(end.toFixed(3));
      ctaV27.role = 'CTA';
      ctaV27.beat_intent = 'CTA';
      ctaV27.crop_focus = 'PRODUCT';
      ctaV27.cut_on = 'REVEAL';
      ctaV27.text_style = 'CTA';
      ctaV27.text_animation = 'FADE';
      ctaV27.text_position = 'CENTER';

      const brandV27 = [
        brief?.brand_name, brief?.brand, brief?.business_name, brief?.business,
        brief?.restaurant_name, brief?.client_name,
        master?.brand_name, master?.brand, master?.business_name, master?.business,
        body?.brand_name, body?.brand, body?.business_name, body?.business,
      ].find((v: any) => typeof v === 'string' && v.trim());
      const titleV27 = String(brief?.title || master?.title || body?.title || '');
      const titleBrandV27 = titleV27.includes('—') ? titleV27.split('—')[0].trim() : titleV27.includes(' - ') ? titleV27.split(' - ')[0].trim() : '';
      const finalBrandV27 = String(brandV27 || titleBrandV27 || '').trim();
      ctaV27.text = finalBrandV27 ? `${finalBrandV27.toUpperCase()}\nVISIT TONIGHT` : 'VISIT TONIGHT';
      ctaV27.emphasis_words = ['VISIT TONIGHT'];

      // Re-sync source moment after the immutable source/window replacement.
      ctaV27.source_moment = {
        ...(ctaV27.source_moment && typeof ctaV27.source_moment === 'object' ? ctaV27.source_moment : {}),
        start: Number(clamp(Number(ctaV27?.source_moment?.start) || start, start, end).toFixed(3)),
        end: Number(clamp(Number(ctaV27?.source_moment?.end) || end, start, end).toFixed(3)),
      };

      // Do not finish a food commercial on a human reaction when a non-human
      // source can perform the penultimate payoff beat.
      if (timeline.length >= 3) {
        const penultimate = timeline[timeline.length - 2];
        const penSource = analyses.find((x: any) => String(x?.filename || '') === String(penultimate?.source_filename || ''));
        const pen = classifyCommercialVisual(penSource);
        if (pen.human >= 8) {
          const alternatives = analyses
            .filter((x: any) => String(x?.filename || '') && String(x.filename) !== String(ctaV27.source_filename) && Number(x?.duration || 0) >= 0.75)
            .map((x: any) => ({ source: x, v: classifyCommercialVisual(x) }))
            .filter(({ v }: any) => v.human < 8)
            .sort((a: any, b: any) => (b.v.hero * 2 + b.v.detail + b.v.action) - (a.v.hero * 2 + a.v.detail + a.v.action));
          const alt = alternatives[0]?.source;
          if (alt) {
            penultimate.source_filename = String(alt.filename);
            const altDuration = Math.max(0.75, Number(alt.duration) || 0.75);
            const altStart = Number.isFinite(Number(alt.suggested_start)) ? Number(alt.suggested_start) : 0;
            const altEnd = Number.isFinite(Number(alt.suggested_end)) ? Number(alt.suggested_end) : Math.min(altDuration, altStart + 1.25);
            penultimate.source_start = Number(clamp(altStart, 0, Math.max(0, altDuration - 0.25)).toFixed(3));
            penultimate.source_end = Number(clamp(Math.max(penultimate.source_start + 0.25, altEnd), penultimate.source_start + 0.25, altDuration).toFixed(3));
            penultimate.source_moment = { start: penultimate.source_start, end: penultimate.source_end };
            penultimate.crop_focus = 'PRODUCT';
          }
        }
      }

      console.warn(`[ATLAS EDIT DIRECTOR] V27 IMMUTABLE CTA | source=${ctaV27.source_filename} | score=${scoreLandingV27(bestV27).toFixed(1)} | brand=${finalBrandV27 || 'NONE'} | window=${ctaV27.source_start}-${ctaV27.source_end}`);
    }
  }
}

contract = checkContracts(timeline);
if (contract.failed) {
  const repaired = repairEditorialContract(timeline, analyses, targetDuration);
  const repairedContract = checkContracts(repaired);
  if (!repairedContract.failed) {
    timeline = repaired;
    contract = repairedContract;
  }
}

// FINAL EDGE PASS: transitions must be decided on the FINAL timeline, after
// narrative/source/pacing repair. This guarantees the renderer receives the
// actual edge decisions that were scored for this exact cut.
timeline = repairTransitionIntelligence(timeline, analyses);

// V27 IMMUTABLE COMMERCIAL LANDING
// Final authority: after ALL source, diversity, typography, pacing and moment
// normalization passes, a food-commercial CTA may only land on a clean finished
// product/hero source. This deliberately runs immediately before validation so
// no later repair can move the CTA back onto active preparation footage.
{
  const foodBriefV27 = `${JSON.stringify(brief || {})} ${JSON.stringify(master || {})}`;
  const isFoodCommercialV27 = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/i.test(foodBriefV27);

  if (isFoodCommercialV27 && timeline.length >= 2 && Array.isArray(analyses) && analyses.length) {
    const sourceTextV27 = (source: any) => [
      source?.shot_type, source?.shotType, source?.recommended_use,
      source?.reason, source?.strengths, source?.problems, source?.description,
      source?.summary, source?.subject, source?.action, source?.composition,
    ].flatMap((v: any) => Array.isArray(v) ? v : [v])
      .map((v: any) => String(v || '').toLowerCase()).join(' ');

    const scoreLandingV27 = (source: any) => {
      const t = sourceTextV27(source);
      const v = classifyCommercialVisual(source);
      let score = Number(source?.score || 0) * 3;

      // Finished-product evidence dominates generic hook/hero language.
      if (/(three plated|plated dishes|plated sushi|finished dish|final dish|completed dish|food showcase|signature dish|dish reveal|hero plating|plated hero|product reveal|beauty shot|menu hero|served presentation)/i.test(t)) score += 140;
      if (/(plated|finished|final dish|completed|served|presentation|platter|plate)/i.test(t)) score += 45;
      if (/(clean|minimal marble|top-down|overhead|sharp image|food is clearly visible)/i.test(t)) score += 20;

      // Active preparation and human reaction are disqualifying tendencies.
      score -= v.action * 14;
      score -= v.human * 12;
      if (/(placing fresh salmon|placing slices|rolling|cutting|slicing|knife|prep|preparing|cooking|chef hands|hands placing|active preparation|eating|bite|mouth|reaction)/i.test(t)) score -= 120;
      if (v.family === 'ACTION') score -= 100;
      if (v.family === 'HUMAN') score -= 100;

      return score;
    };

    const rankedV27 = analyses
      .filter((x: any) => String(x?.filename || '') && Number(x?.duration || 0) >= 0.75)
      .map((source: any) => ({ source, score: scoreLandingV27(source) }))
      .sort((a: any, b: any) => b.score - a.score);

    // Require actual finished-product evidence; never fall back to a generic
    // high-scoring action clip merely because it scored well as a hook.
    const bestV27 = rankedV27.find(({ source }: any) => {
      const t = sourceTextV27(source);
      const v = classifyCommercialVisual(source);
      return /(plated|finished dish|final dish|completed dish|food showcase|signature dish|dish reveal|hero plating|plated hero|product reveal|beauty shot|menu hero|served|presentation|platter)/i.test(t)
        && v.action < 8
        && v.human < 8;
    })?.source;

    const ctaV27 = timeline[timeline.length - 1];
    if (bestV27 && ctaV27) {
      const duration = Math.max(0.75, Number(bestV27.duration) || 0.75);
      const bounds = PACING_BOUNDS.CTA;
      const preferredStart = Number(bestV27.suggested_start);
      const preferredEnd = Number(bestV27.suggested_end);
      let start = Number.isFinite(preferredStart) ? preferredStart : 0;
      let end = Number.isFinite(preferredEnd) ? preferredEnd : start + bounds.max;

      start = clamp(start, 0, Math.max(0, duration - bounds.min));
      end = Math.min(duration, Math.max(start + bounds.min, end));
      if (end - start > bounds.max) end = start + bounds.max;
      if (end > duration) {
        end = duration;
        start = Math.max(0, end - bounds.max);
      }

      ctaV27.source_filename = String(bestV27.filename);
      ctaV27.source_start = Number(start.toFixed(3));
      ctaV27.source_end = Number(end.toFixed(3));
      ctaV27.role = 'CTA';
      ctaV27.beat_intent = 'CTA';
      ctaV27.crop_focus = 'PRODUCT';
      ctaV27.cut_on = 'REVEAL';
      ctaV27.text_style = 'CTA';
      ctaV27.text_animation = 'FADE';
      ctaV27.text_position = 'CENTER';

      const brandV27 = [
        brief?.brand_name, brief?.brand, brief?.business_name, brief?.business,
        brief?.restaurant_name, brief?.client_name,
        master?.brand_name, master?.brand, master?.business_name, master?.business,
        body?.brand_name, body?.brand, body?.business_name, body?.business,
      ].find((v: any) => typeof v === 'string' && v.trim());
      const titleV27 = String(brief?.title || master?.title || body?.title || '');
      const titleBrandV27 = titleV27.includes('—') ? titleV27.split('—')[0].trim() : titleV27.includes(' - ') ? titleV27.split(' - ')[0].trim() : '';
      const finalBrandV27 = String(brandV27 || titleBrandV27 || '').trim();
      ctaV27.text = finalBrandV27 ? `${finalBrandV27.toUpperCase()}\nVISIT TONIGHT` : 'VISIT TONIGHT';
      ctaV27.emphasis_words = ['VISIT TONIGHT'];

      // Re-sync source moment after the immutable source/window replacement.
      ctaV27.source_moment = {
        ...(ctaV27.source_moment && typeof ctaV27.source_moment === 'object' ? ctaV27.source_moment : {}),
        start: Number(clamp(Number(ctaV27?.source_moment?.start) || start, start, end).toFixed(3)),
        end: Number(clamp(Number(ctaV27?.source_moment?.end) || end, start, end).toFixed(3)),
      };

      // Do not finish a food commercial on a human reaction when a non-human
      // source can perform the penultimate payoff beat.
      if (timeline.length >= 3) {
        const penultimate = timeline[timeline.length - 2];
        const penSource = analyses.find((x: any) => String(x?.filename || '') === String(penultimate?.source_filename || ''));
        const pen = classifyCommercialVisual(penSource);
        if (pen.human >= 8) {
          const alternatives = analyses
            .filter((x: any) => String(x?.filename || '') && String(x.filename) !== String(ctaV27.source_filename) && Number(x?.duration || 0) >= 0.75)
            .map((x: any) => ({ source: x, v: classifyCommercialVisual(x) }))
            .filter(({ v }: any) => v.human < 8)
            .sort((a: any, b: any) => (b.v.hero * 2 + b.v.detail + b.v.action) - (a.v.hero * 2 + a.v.detail + a.v.action));
          const alt = alternatives[0]?.source;
          if (alt) {
            penultimate.source_filename = String(alt.filename);
            const altDuration = Math.max(0.75, Number(alt.duration) || 0.75);
            const altStart = Number.isFinite(Number(alt.suggested_start)) ? Number(alt.suggested_start) : 0;
            const altEnd = Number.isFinite(Number(alt.suggested_end)) ? Number(alt.suggested_end) : Math.min(altDuration, altStart + 1.25);
            penultimate.source_start = Number(clamp(altStart, 0, Math.max(0, altDuration - 0.25)).toFixed(3));
            penultimate.source_end = Number(clamp(Math.max(penultimate.source_start + 0.25, altEnd), penultimate.source_start + 0.25, altDuration).toFixed(3));
            penultimate.source_moment = { start: penultimate.source_start, end: penultimate.source_end };
            penultimate.crop_focus = 'PRODUCT';
          }
        }
      }

      console.warn(`[ATLAS EDIT DIRECTOR] V27 IMMUTABLE CTA | source=${ctaV27.source_filename} | score=${scoreLandingV27(bestV27).toFixed(1)} | brand=${finalBrandV27 || 'NONE'} | window=${ctaV27.source_start}-${ctaV27.source_end}`);
    }
  }
}

contract = checkContracts(timeline);
if (contract.failed) {
  const repaired = repairEditorialContract(timeline, analyses, targetDuration);
  const repairedContract = checkContracts(repaired);
  if (!repairedContract.failed) {
    // A bounded repair can rewrite the final timeline. Re-apply transition
    // intelligence once more so those repairs can never silently erase the
    // final edge decisions.
    timeline = repairTransitionIntelligence(repaired, analyses);
    contract = checkContracts(timeline);
  }
}

if (contract.failed) {
  console.warn(
    `[ATLAS EDIT DIRECTOR] premium pass still has contract violations; continuing to commercial finalization/normalization | ${[
      ...contract.pacing.violations,
      ...contract.editorial.violations,
    ].filter(Boolean).join(" | ")}`,
  );
}

// V18 COMMERCIAL FINAL POLISH: final source landing, transition restraint,
// and renderer-aware duration before hard contract finalization.
timeline = applyCommercialFinalPolish(timeline, analyses, brief, targetDuration);
contract = checkContracts(timeline);

// V20 COMMERCIAL SOURCE UNIQUENESS
// For premium food commercials, if there are enough real sources, each beat
// should use a distinct source. Repeated non-adjacent prep shots are still
// repetition from the viewer's perspective. Preserve HOOK/CTA anchors.
{
  const isFood = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/i
    .test(JSON.stringify(brief || {}) + " " + (analyses || []).map((x: any) => JSON.stringify(x)).join(" "));

  if (isFood && timeline.length > 1 && analyses.length >= timeline.length) {
    const sourceTextV20 = (source: any) => [
      source?.shot_type, source?.shotType, source?.recommended_use,
      source?.reason, source?.strengths, source?.description, source?.summary,
      source?.subject, source?.action, source?.composition,
    ].flatMap((v: any) => Array.isArray(v) ? v : [v])
      .map((v: any) => String(v || "").toLowerCase()).join(" ");

    const familyV20 = (source: any) => {
      const s = sourceTextV20(source);
      if (/(finished|plated|hero|signature dish|final dish|food showcase|dish reveal|menu hero|beauty shot)/.test(s)) return "HERO";
      if (/(customer|guest|people|person|woman|man|eating|dining|server|waiter|reaction|lifestyle)/.test(s)) return "HUMAN";
      if (/(flame|torch|fire|knife|slice|slicing|cutting|rolling|shaping|assembling|placing|plating|chef|cooking|cook|prep|process|craft)/.test(s)) return "ACTION";
      if (/(salmon|fish|rice|garnish|ingredient|texture|macro|detail|sauce|sushi close)/.test(s)) return "DETAIL";
      if (/(overhead|top.?down|wide|establish|environment|interior|exterior|restaurant|context|room)/.test(s)) return "CONTEXT";
      return "OTHER";
    };

    const preferredV20: Record<string, string[]> = {
      HOOK_IMPACT: ["ACTION", "DETAIL", "HERO", "CONTEXT", "HUMAN"],
      PROBLEM: ["HUMAN", "CONTEXT", "DETAIL", "ACTION", "HERO"],
      ACTION: ["ACTION", "DETAIL", "HUMAN", "HERO", "CONTEXT"],
      PROOF: ["DETAIL", "ACTION", "HERO", "HUMAN", "CONTEXT"],
      ESCALATION: ["ACTION", "DETAIL", "HERO", "HUMAN", "CONTEXT"],
      TRANSFORMATION: ["HERO", "ACTION", "DETAIL", "HUMAN", "CONTEXT"],
      HERO: ["HERO", "CONTEXT", "HUMAN", "DETAIL", "ACTION"],
      CTA: ["HERO", "CONTEXT", "DETAIL", "HUMAN", "ACTION"],
    };

    const familyRankV20 = (family: string, intent: string) => {
      const list = preferredV20[intent] || ["ACTION", "DETAIL", "HERO", "HUMAN", "CONTEXT"];
      const index = list.indexOf(family);
      return index < 0 ? 0 : 40 - index * 7;
    };

    const scoreV20 = (source: any, beat: any, index: number) => {
      const intent = String(beat?.beat_intent || beat?.role || "STORY").toUpperCase();
      const family = familyV20(source);
      const visual = classifyCommercialVisual(source);
      let score = familyRankV20(family, intent);
      if (intent === "CTA") score += visual.hero * 2 - visual.action * 3 - visual.human * 3;
      if (["TRANSFORMATION", "HERO"].includes(intent)) score += visual.hero - visual.human * 2;
      if (["ACTION", "ESCALATION"].includes(intent)) score += visual.action * 1.5;
      score += Math.min(30, Math.max(0, Number(source?.score || 0)));
      if (index === 0 && ["ACTION", "DETAIL", "HERO"].includes(family)) score += 8;
      if (index === timeline.length - 1 && family === "HERO") score += 45;
      if (index === timeline.length - 2 && family === "HUMAN") score -= 15;
      if (["TRANSFORMATION", "HERO"].includes(intent) && family === "HUMAN") score -= 20;
      return score;
    };

    const locked = new Set<number>([0, timeline.length - 1]);
    const usedV20 = new Set<string>();

    for (const index of locked) {
      const name = String(timeline[index]?.source_filename || "");
      if (name) usedV20.add(name);
    }

    for (let i = 1; i < timeline.length - 1; i++) {
      const currentName = String(timeline[i]?.source_filename || "");
      if (currentName && !usedV20.has(currentName)) {
        usedV20.add(currentName);
        continue;
      }

      const beat = timeline[i];
      const replacement = analyses
        .filter((source: any) => {
          const name = String(source?.filename || "");
          return name && !usedV20.has(name) && Number(source?.duration || 0) >= 0.25;
        })
        .map((source: any) => ({ source, score: scoreV20(source, beat, i) }))
        .sort((a, b) => b.score - a.score)[0]?.source;

      if (!replacement) continue;

      const role = String(beat?.role || "STORY").toUpperCase();
      const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
      const duration = Math.max(0.25, Number(replacement.duration) || 0.25);
      let start = Number(replacement.suggested_start);
      let end = Number(replacement.suggested_end);
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end)) end = start + bounds.min;

      start = clamp(start, 0, Math.max(0, duration - 0.25));
      end = clamp(Math.max(start + bounds.min, end), start + bounds.min, duration);
      if (end - start > bounds.max) end = Math.min(duration, start + bounds.max);
      if (end - start < bounds.min - 0.001) {
        end = Math.min(duration, start + bounds.min);
        start = Math.max(0, end - bounds.min);
      }

      beat.source_filename = String(replacement.filename);
      beat.source_start = Number(start.toFixed(3));
      beat.source_end = Number(end.toFixed(3));
      beat.editorial_score = Math.max(
        Number(beat?.editorial_score || 0),
        Number(replacement?.score || 0),
      );
      usedV20.add(String(replacement.filename));
    }
  }
}

// V21 COMMERCIAL SEMANTIC STORY PASS
// Filename uniqueness is not enough: two different files can still depict the
// same visual idea. For food commercials, enforce a meaningful family arc while
// preserving HOOK/CTA anchors and only replacing a beat when a materially better
// semantic candidate exists.
{
  const isFoodV21 = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/i
    .test(JSON.stringify(brief || {}) + " " + (analyses || []).map((x: any) => JSON.stringify(x)).join(" "));

  if (isFoodV21 && timeline.length >= 6 && analyses.length >= timeline.length) {
    const intents = timeline.map((beat: any, i: number) =>
      String(beat?.beat_intent || (i === 0 ? "HOOK_IMPACT" : i === timeline.length - 1 ? "CTA" : "ACTION")).toUpperCase());

    const preferred: Record<string, string[]> = {
      HOOK_IMPACT: ["ACTION", "DETAIL", "HERO", "CONTEXT"],
      PROBLEM: ["HUMAN", "CONTEXT", "DETAIL", "ACTION"],
      ACTION: ["ACTION", "DETAIL", "HUMAN", "CONTEXT"],
      PROOF: ["DETAIL", "ACTION", "HERO", "CONTEXT"],
      ESCALATION: ["ACTION", "DETAIL", "HERO", "HUMAN"],
      TRANSFORMATION: ["HERO", "DETAIL", "ACTION"],
      HERO: ["HERO", "DETAIL", "CONTEXT"],
      CTA: ["HERO", "CONTEXT"],
    };

    const byNameV21 = new Map((analyses || []).map((x: any) => [String(x?.filename || ""), x]));
    const locked = new Set<number>([0, timeline.length - 1]);
    const used = new Set<string>(
      [...locked].map((i) => String(timeline[i]?.source_filename || "")).filter(Boolean),
    );

    const windowForV21 = (source: any, beat: any) => {
      const role = String(beat?.role || "STORY").toUpperCase();
      const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
      const duration = Math.max(0.25, Number(source?.duration) || 0.25);
      let start = Number(source?.suggested_start);
      let end = Number(source?.suggested_end);
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end)) end = Math.min(duration, start + bounds.max);
      start = clamp(start, 0, Math.max(0, duration - 0.25));
      end = clamp(Math.max(start + bounds.min, end), start + bounds.min, duration);
      if (end - start > bounds.max) end = Math.min(duration, start + bounds.max);
      if (end - start < bounds.min) {
        end = Math.min(duration, start + bounds.min);
        start = Math.max(0, end - bounds.min);
      }
      return { start, end };
    };

    const scoreV21 = (source: any, beat: any, index: number) => {
      const intent = intents[index];
      const visual = classifyCommercialVisual(source);
      const prefs = preferred[intent] || ["ACTION", "DETAIL", "HERO", "HUMAN", "CONTEXT"];
      const rank = prefs.indexOf(visual.family);
      let score = rank >= 0 ? 60 - rank * 13 : 0;
      score += Math.min(25, Math.max(0, Number(source?.score || 0)) * 0.5);
      score += visual.hero * (intent === "CTA" || intent === "HERO" || intent === "TRANSFORMATION" ? 2.5 : 0.35);
      score += visual.action * (["HOOK_IMPACT", "ACTION", "ESCALATION"].includes(intent) ? 1.7 : -0.5);
      score += visual.detail * (["PROOF", "TRANSFORMATION", "HERO"].includes(intent) ? 1.4 : 0.25);
      score -= visual.human * (["TRANSFORMATION", "HERO", "CTA"].includes(intent) ? 2.2 : 0.1);
      if (index === 0 && visual.family === "ACTION") score += 18;
      if (index === timeline.length - 1 && visual.family === "HERO" && visual.action < 8 && visual.human < 8) score += 45;
      return score;
    };

    // First lock the CTA to the strongest genuinely clean hero.
    const ctaCandidates = analyses
      .filter((source: any) => {
        const v = classifyCommercialVisual(source);
        return String(source?.filename || "") && v.family === "HERO" && v.action < 8 && v.human < 8;
      })
      .sort((a: any, b: any) => scoreV21(b, timeline[timeline.length - 1], timeline.length - 1) - scoreV21(a, timeline[timeline.length - 1], timeline.length - 1));

    if (ctaCandidates.length) {
      const cta = ctaCandidates[0];
      const win = windowForV21(cta, timeline[timeline.length - 1]);
      timeline[timeline.length - 1].source_filename = String(cta.filename);
      timeline[timeline.length - 1].source_start = Number(win.start.toFixed(3));
      timeline[timeline.length - 1].source_end = Number(win.end.toFixed(3));
      timeline[timeline.length - 1].crop_focus = "PRODUCT";
      timeline[timeline.length - 1].beat_intent = "CTA";
      timeline[timeline.length - 1].role = "CTA";
      used.add(String(cta.filename));
    }

    // Fill the middle by semantic job, not merely unused filename.
    for (let i = 1; i < timeline.length - 1; i++) {
      const beat = timeline[i];
      const current = byNameV21.get(String(beat?.source_filename || ""));
      const currentVisual = classifyCommercialVisual(current);
      const previousVisual = classifyCommercialVisual(byNameV21.get(String(timeline[i - 1]?.source_filename || "")));
      const nextVisual = classifyCommercialVisual(byNameV21.get(String(timeline[i + 1]?.source_filename || "")));
      const currentScore = current ? scoreV21(current, beat, i) : -Infinity;

      const candidates = analyses
        .filter((source: any) => {
          const name = String(source?.filename || "");
          const v = classifyCommercialVisual(source);
          return name && !used.has(name) && Number(source?.duration || 0) >= 0.75 &&
            v.family !== "OTHER";
        })
        .map((source: any) => {
          const v = classifyCommercialVisual(source);
          let score = scoreV21(source, beat, i);
          if (v.family === previousVisual.family) score -= 18;
          if (v.family === nextVisual.family) score -= 12;
          if (v.family === currentVisual.family) score -= 10;
          return { source, score };
        })
        .sort((a, b) => b.score - a.score);

      const best = candidates[0];
      if (!best) continue;

      // Only replace a non-duplicate current source when the new semantic fit
      // is meaningfully stronger. This prevents the pass from becoming a
      // destructive reorder engine.
      if (current && !used.has(String(current.filename)) && best.score - currentScore < 14) {
        used.add(String(current.filename));
        continue;
      }

      const win = windowForV21(best.source, beat);
      beat.source_filename = String(best.source.filename);
      beat.source_start = Number(win.start.toFixed(3));
      beat.source_end = Number(win.end.toFixed(3));
      beat.editorial_score = Math.max(Number(beat?.editorial_score || 0), Number(best.source?.score || 0));
      beat.crop_focus = ["HERO", "TRANSFORMATION", "CTA"].includes(intents[i]) ? "PRODUCT" :
        intents[i] === "HOOK_IMPACT" ? "ACTION" : "CENTER";
      used.add(String(best.source.filename));
    }
  }
}

// V22 COMMERCIAL LANDING LOCK
// The last thing the editor must decide is the commercial landing.
// Vision's generic "hook" label is not allowed to override explicit evidence
// that a source is a finished-product / hero / CTA frame. This lock runs after
// V20/V21 source assignment so later diversity passes cannot move the CTA back
// onto active preparation footage.
{
  const foodBrief = `${JSON.stringify(brief || {})} ${(analyses || []).map((x: any) => JSON.stringify(x)).join(" ")}`;
  const isFoodCommercial = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/i.test(foodBrief);

  if (isFoodCommercial && timeline.length >= 2 && analyses?.length) {
    const textOf = (source: any) => [
      source?.shot_type, source?.shotType, source?.recommended_use,
      source?.reason, source?.strengths, source?.problems, source?.description,
      source?.summary, source?.subject, source?.action, source?.composition,
    ].flatMap((v: any) => Array.isArray(v) ? v : [v])
      .map((v: any) => String(v || "").toLowerCase()).join(" ");

    const landingScore = (source: any) => {
      const t = textOf(source);
      const v = classifyCommercialVisual(source);
      let score = 0;

      // Strong positive evidence: this is actually described as a landing/hero.
      if (/(usable_for[^.]{0,80}(cta|brand memory|hero|payoff)|cta\s*\/\s*brand|brand-facing)/i.test(t)) score += 70;
      if (/(hero plating|plating moment before a cta|hero reveal|plated hero|finished product|finished dish|final dish|product reveal|food showcase|signature dish|beauty shot|menu hero)/i.test(t)) score += 60;
      if (/(plated|finished|final dish|completed dish|served|presentation)/i.test(t)) score += 30;
      if (/(plate|platter|spread|product)/i.test(t)) score += 12;

      // Negative evidence is intentionally strong: active preparation is not a
      // premium CTA merely because Vision called it a "hook" or "hero".
      score -= v.action * 9;
      score -= v.human * 7;
      if (/(placing|rolling|cutting|slicing|knife|prep|preparing|cooking|chef hands|salmon being placed)/i.test(t)) score -= 35;

      score += Math.min(20, Number(source?.score || 0) * 0.20);
      if (v.family === "HERO") score += 30;
      if (v.family === "ACTION") score -= 35;
      if (v.family === "HUMAN") score -= 30;

      return score;
    };

    const rankedLanding = analyses
      .filter((source: any) => String(source?.filename || "") && Number(source?.duration || 0) >= 0.75)
      .map((source: any) => ({ source, score: landingScore(source) }))
      .sort((a: any, b: any) => b.score - a.score);

    // Prefer a true clean hero even if it was already used earlier. A strong
    // repeated hero is better than ending on the wrong visual family.
    const bestLanding = rankedLanding[0]?.source;
    if (bestLanding) {
      const ctaIndex = timeline.length - 1;
      const cta = timeline[ctaIndex];
      const duration = Math.max(0.75, Number(bestLanding.duration) || 0.75);
      const bounds = PACING_BOUNDS.CTA;

      let start = Number(bestLanding.suggested_start);
      let end = Number(bestLanding.suggested_end);
      if (!Number.isFinite(start)) start = 0;
      if (!Number.isFinite(end)) end = Math.min(duration, start + bounds.max);

      // Prefer the cleanest ~1.5–1.8s portion for a premium CTA.
      start = clamp(start, 0, Math.max(0, duration - bounds.min));
      end = Math.min(duration, start + Math.min(bounds.max, 1.75));
      if (end - start < bounds.min) {
        end = Math.min(duration, start + bounds.min);
        start = Math.max(0, end - bounds.min);
      }

      cta.source_filename = String(bestLanding.filename);
      cta.source_start = Number(start.toFixed(3));
      cta.source_end = Number(end.toFixed(3));
      cta.role = "CTA";
      cta.beat_intent = "CTA";
      cta.crop_focus = "PRODUCT";
      cta.cut_on = "REVEAL";

      // V26: resolve brand from the complete request payload, not only creative_brief.
      // Never render a fake placeholder such as "YOUR BRAND".
      const briefObj: any = brief || {};
      const masterObj: any = master || {};
      const rawObj: any = raw || {};
      const structuredBrand = [
        briefObj?.brand_name, briefObj?.brand, briefObj?.business_name,
        briefObj?.business, briefObj?.restaurant_name, briefObj?.client_name,
        masterObj?.brand_name, masterObj?.brand, masterObj?.business_name,
        masterObj?.business, masterObj?.restaurant_name, masterObj?.client_name,
        rawObj?.brand_name, rawObj?.brand, rawObj?.business_name,
        rawObj?.business, rawObj?.restaurant_name, rawObj?.client_name,
        body?.brand_name, body?.brand, body?.business_name, body?.business,
        body?.restaurant_name, body?.client_name,
      ].find((v: any) => typeof v === "string" && v.trim());

      const titleCandidates = [
        String(briefObj?.title || ""),
        String(masterObj?.title || ""),
        String(rawObj?.title || ""),
        String(body?.title || ""),
      ].filter(Boolean);
      const titleBrand = titleCandidates
        .map((title: string) => title.includes("—")
          ? title.split("—")[0].trim()
          : title.includes(" - ")
            ? title.split(" - ")[0].trim()
            : "")
        .find(Boolean) || "";

      const brand = String(structuredBrand || titleBrand || "").trim();
      const cleanBrand = brand || "";
      cta.text = cleanBrand
        ? `${cleanBrand.toUpperCase()}\nVISIT TONIGHT`
        : "VISIT TONIGHT";
      cta.text_style = "CTA";
      cta.text_animation = "FADE";
      cta.text_position = "CENTER";
      cta.emphasis_words = ["VISIT TONIGHT"];
    }
  }
}

// V17 FINAL CONTRACT FINALIZER
// The final narrative/transition passes can rewrite source windows after
// earlier repairs. Hard invariants get one deterministic pass immediately
// before the executable plan is built.
if (timeline.length) {
  timeline[0].role = "HOOK";
  timeline[0].beat_intent = "HOOK_IMPACT";
  timeline[timeline.length - 1].role = "CTA";
  timeline[timeline.length - 1].beat_intent = "CTA";

  const finalByName = new Map(
    (analyses || []).map((x: any) => [String(x?.filename || ""), x]),
  );

  for (const beat of timeline) {
    const role = String(beat?.role || "STORY").toUpperCase();
    const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
    const source = finalByName.get(String(beat?.source_filename || ""));
    const sourceDuration = Number(source?.duration) || 0;

    let start = Number(beat?.source_start);
    let end = Number(beat?.source_end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    start = Math.max(0, start);
    end = Math.max(start, end);

    // Hard maximum first: trim the least useful lead-in while preserving
    // the selected visual end/cut point.
    if (end - start > bounds.max) {
      start = end - bounds.max;
    }

    // Only expand when the beat is below its minimum.
    if (end - start < bounds.min) {
      const needed = bounds.min - (end - start);
      const roomBefore = Math.max(0, start);
      const addBefore = Math.min(needed, roomBefore);
      start -= addBefore;

      const stillNeeded = bounds.min - (end - start);
      if (stillNeeded > 0 && sourceDuration > 0) {
        const roomAfter = Math.max(0, sourceDuration - end);
        end += Math.min(stillNeeded, roomAfter);
      }
    }

    if (sourceDuration > 0) {
      start = Math.min(start, Math.max(0, sourceDuration - 0.25));
      end = Math.min(end, sourceDuration);
    }

    // Final numerical guard.
    if (end - start > bounds.max) start = end - bounds.max;

    beat.source_start = Number(Math.max(0, start).toFixed(3));
    beat.source_end = Number(Math.max(beat.source_start + 0.25, end).toFixed(3));

    // V23 SOURCE-MOMENT LOCK
    // Source windows can be rewritten by commercial landing/diversity passes
    // after Vision selected a source_moment. The executable V2 contract treats
    // sourceMoment as an absolute timestamp inside the selected source window,
    // so never allow a stale moment to survive a window/source reassignment.
    const windowStart = beat.source_start;
    const windowEnd = beat.source_end;
    const existingMoment = beat?.source_moment;
    let momentStart = Number(existingMoment?.start);
    let momentEnd = Number(existingMoment?.end);

    if (!Number.isFinite(momentStart) || !Number.isFinite(momentEnd)) {
      momentStart = windowStart;
      momentEnd = windowEnd;
    }

    // If the old moment does not intersect the new source window at all, use
    // the full selected window rather than pointing outside the source. If it
    // partially overlaps, preserve as much of the original moment as possible.
    if (momentEnd < windowStart || momentStart > windowEnd) {
      momentStart = windowStart;
      momentEnd = windowEnd;
    } else {
      momentStart = clamp(momentStart, windowStart, windowEnd);
      momentEnd = clamp(momentEnd, windowStart, windowEnd);
    }

    if (momentEnd < momentStart) {
      const mid = (windowStart + windowEnd) / 2;
      momentStart = mid;
      momentEnd = mid;
    }

    beat.source_moment = {
      ...(existingMoment && typeof existingMoment === "object" ? existingMoment : {}),
      start: Number(momentStart.toFixed(3)),
      end: Number(momentEnd.toFixed(3)),
    };
  }

  // Final adjacency repair after ALL commercial polish changes. This is
  // intentionally after CTA landing because CTA source replacement can create
  // a new duplicate with the preceding beat.
  timeline = repairAdjacentSourceDuplicates(timeline);

  // Keep typography sparse: HOOK + strongest payoff/transform beat + CTA.
  const textIndexes = timeline
    .map((beat: any, index: number) => ({ beat, index }))
    .filter(({ beat }: any) => String(beat?.text || "").trim().length > 0);

  if (textIndexes.length > 3) {
    const keep = new Set<number>([0, timeline.length - 1]);
    const payoffIndex = timeline.findIndex((beat: any) =>
      String(beat?.role || "").toUpperCase() === "PAYOFF" ||
      ["TRANSFORMATION", "HERO"].includes(String(beat?.beat_intent || "").toUpperCase()),
    );
    if (payoffIndex > 0 && payoffIndex < timeline.length - 1) keep.add(payoffIndex);

    for (const { index } of textIndexes) {
      if (keep.size >= 3) break;
      if (index !== 0 && index !== timeline.length - 1) keep.add(index);
    }
    for (const { beat, index } of textIndexes) {
      if (!keep.has(index)) beat.text = "";
    }
  }
}

// V26 EXECUTION CONTRACT FINALIZATION
// Earlier contract failures are warnings only; this finalizer is authoritative.
// V24 FINAL CONTRACT NORMALIZER
// This is the last deterministic pass before buildV2EditPlan. Earlier repairs
// can rewrite source windows, source assignments, or text, so the final pass
// must guarantee the executable contract rather than merely checking it.
if (timeline.length) {
  const byNameV24 = new Map(
    (analyses || []).map((x: any) => [String(x?.filename || ""), x]),
  );

  // 1) Normalize every source window and source_moment together. This also
  // repairs moments after the final adjacency/source replacement pass.
  for (const beat of timeline) {
    const role = String(beat?.role || "STORY").toUpperCase();
    const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
    const source = byNameV24.get(String(beat?.source_filename || ""));
    const sourceDuration = Math.max(0.25, Number(source?.duration) || 0.25);

    let start = Number(beat?.source_start);
    let end = Number(beat?.source_end);
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = start + bounds.min;

    start = clamp(start, 0, Math.max(0, sourceDuration - 0.25));
    end = Math.max(start + 0.25, end);

    if (end - start > bounds.max) end = start + bounds.max;
    if (end > sourceDuration) {
      end = sourceDuration;
      start = Math.max(0, end - bounds.max);
    }
    if (end - start < bounds.min) {
      const desired = Math.min(bounds.min, sourceDuration);
      if (sourceDuration >= desired) {
        const center = (start + end) / 2;
        start = clamp(center - desired / 2, 0, sourceDuration - desired);
        end = start + desired;
      } else {
        start = 0;
        end = sourceDuration;
      }
    }

    beat.source_start = Number(start.toFixed(3));
    beat.source_end = Number(end.toFixed(3));

    const ws = beat.source_start;
    const we = beat.source_end;
    const existing = beat?.source_moment;
    let ms = Number(existing?.start);
    let me = Number(existing?.end);
    if (!Number.isFinite(ms) || !Number.isFinite(me) || me < ws || ms > we) {
      ms = ws;
      me = we;
    } else {
      ms = clamp(ms, ws, we);
      me = clamp(me, ws, we);
    }
    if (me < ms) { ms = ws; me = we; }
    beat.source_moment = {
      ...(existing && typeof existing === "object" ? existing : {}),
      start: Number(ms.toFixed(3)),
      end: Number(me.toFixed(3)),
    };
  }

  // 2) Guarantee enough timeline duration. The previous mechanical repair
  // enforced per-beat minimums but could still leave a 13.5s timeline against
  // a 15s target. Expand eligible beats inside their real source bounds until
  // the 90% target floor is reached, without exceeding role maxima.
  const targetV24 = clamp(Number(targetDuration) || 15, 8, 60);
  const minTotalV24 = targetV24 * 0.90;
  let totalV24 = timeline.reduce(
    (sum, beat) => {
      const sourceSpan = Math.max(0, Number(beat?.source_end || 0) - Number(beat?.source_start || 0));
      const speed = Math.max(0.5, Number(beat?.speed) || 1);
      return sum + sourceSpan / speed;
    },
    0,
  );

  if (totalV24 < minTotalV24) {
    const expandable = [...timeline]
      .map((beat: any, index: number) => ({ beat, index }))
      .sort((a, b) => {
        const ar = String(a.beat?.role || "STORY").toUpperCase();
        const br = String(b.beat?.role || "STORY").toUpperCase();
        // CTA gets the most room, then payoff/story; hook stays punchy.
        const weight = (r: string) => r === "CTA" ? 4 : r === "PAYOFF" ? 3 : r === "STORY" ? 2 : 1;
        return weight(br) - weight(ar);
      });

    for (const { beat } of expandable) {
      if (totalV24 >= minTotalV24 - 0.001) break;
      const role = String(beat?.role || "STORY").toUpperCase();
      const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
      const source = byNameV24.get(String(beat?.source_filename || ""));
      const sourceDuration = Math.max(0.25, Number(source?.duration) || 0.25);
      let start = Number(beat.source_start);
      let end = Number(beat.source_end);
      const current = end - start;
      const speed = Math.max(0.5, Number(beat?.speed) || 1);
      const displayedCurrent = current / speed;
      const roomToMaxSource = Math.max(0, (bounds.max - displayedCurrent) * speed);
      const roomInSource = Math.max(0, sourceDuration - end) + Math.max(0, start);
      const requiredDisplayed = Math.max(0, minTotalV24 - totalV24);
      const add = Math.min(roomToMaxSource, roomInSource, requiredDisplayed * speed);
      if (add <= 0.001) continue;

      // Expand symmetrically where possible, then use the remaining side.
      const before = Math.min(add / 2, start);
      const after = add - before;
      start -= before;
      end += Math.min(after, Math.max(0, sourceDuration - end));
      const actualAdd = (end - start) - current;
      if (actualAdd > 0) {
        beat.source_start = Number(start.toFixed(3));
        beat.source_end = Number(end.toFixed(3));
        totalV24 += actualAdd / speed;

        const ws = beat.source_start;
        const we = beat.source_end;
        beat.source_moment = {
          ...(beat?.source_moment && typeof beat.source_moment === "object" ? beat.source_moment : {}),
          start: Number(clamp(Number(beat?.source_moment?.start) || ws, ws, we).toFixed(3)),
          end: Number(clamp(Number(beat?.source_moment?.end) || we, ws, we).toFixed(3)),
        };
      }
    }
  }

  // 3) Final sparse typography lock: HOOK + strongest payoff/transform + CTA.
  const textIndexesV24 = timeline
    .map((beat: any, index: number) => ({ beat, index }))
    .filter(({ beat }: any) => String(beat?.text || "").trim().length > 0);
  if (textIndexesV24.length > 3) {
    const keep = new Set<number>([0, timeline.length - 1]);
    const payoffIndex = timeline.findIndex((beat: any) =>
      String(beat?.role || "").toUpperCase() === "PAYOFF" ||
      ["TRANSFORMATION", "HERO"].includes(String(beat?.beat_intent || "").toUpperCase()),
    );
    if (payoffIndex > 0 && payoffIndex < timeline.length - 1) keep.add(payoffIndex);
    for (const { index } of textIndexesV24) {
      if (keep.size >= 3) break;
      if (index !== 0 && index !== timeline.length - 1) keep.add(index);
    }
    for (const { beat, index } of textIndexesV24) {
      if (!keep.has(index)) beat.text = "";
    }
  }

  console.warn(
    `[ATLAS EDIT DIRECTOR] V24 final contract normalization | displayedDuration=${totalV24.toFixed(2)}s/${targetV24.toFixed(2)}s | text=${timeline.filter((x: any) => String(x?.text || "").trim()).length}`,
  );
}


// V27 IMMUTABLE COMMERCIAL LANDING
// Final authority: after ALL source, diversity, typography, pacing and moment
// normalization passes, a food-commercial CTA may only land on a clean finished
// product/hero source. This deliberately runs immediately before validation so
// no later repair can move the CTA back onto active preparation footage.
{
  const foodBriefV27 = `${JSON.stringify(brief || {})} ${JSON.stringify(master || {})}`;
  const isFoodCommercialV27 = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/i.test(foodBriefV27);

  if (isFoodCommercialV27 && timeline.length >= 2 && Array.isArray(analyses) && analyses.length) {
    const sourceTextV27 = (source: any) => [
      source?.shot_type, source?.shotType, source?.recommended_use,
      source?.reason, source?.strengths, source?.problems, source?.description,
      source?.summary, source?.subject, source?.action, source?.composition,
    ].flatMap((v: any) => Array.isArray(v) ? v : [v])
      .map((v: any) => String(v || '').toLowerCase()).join(' ');

    const scoreLandingV27 = (source: any) => {
      const t = sourceTextV27(source);
      const v = classifyCommercialVisual(source);
      let score = Number(source?.score || 0) * 3;

      // Finished-product evidence dominates generic hook/hero language.
      if (/(three plated|plated dishes|plated sushi|finished dish|final dish|completed dish|food showcase|signature dish|dish reveal|hero plating|plated hero|product reveal|beauty shot|menu hero|served presentation)/i.test(t)) score += 140;
      if (/(plated|finished|final dish|completed|served|presentation|platter|plate)/i.test(t)) score += 45;
      if (/(clean|minimal marble|top-down|overhead|sharp image|food is clearly visible)/i.test(t)) score += 20;

      // Active preparation and human reaction are disqualifying tendencies.
      score -= v.action * 14;
      score -= v.human * 12;
      if (/(placing fresh salmon|placing slices|rolling|cutting|slicing|knife|prep|preparing|cooking|chef hands|hands placing|active preparation|eating|bite|mouth|reaction)/i.test(t)) score -= 120;
      if (v.family === 'ACTION') score -= 100;
      if (v.family === 'HUMAN') score -= 100;

      return score;
    };

    const rankedV27 = analyses
      .filter((x: any) => String(x?.filename || '') && Number(x?.duration || 0) >= 0.75)
      .map((source: any) => ({ source, score: scoreLandingV27(source) }))
      .sort((a: any, b: any) => b.score - a.score);

    // Require actual finished-product evidence; never fall back to a generic
    // high-scoring action clip merely because it scored well as a hook.
    const bestV27 = rankedV27.find(({ source }: any) => {
      const t = sourceTextV27(source);
      const v = classifyCommercialVisual(source);
      return /(plated|finished dish|final dish|completed dish|food showcase|signature dish|dish reveal|hero plating|plated hero|product reveal|beauty shot|menu hero|served|presentation|platter)/i.test(t)
        && v.action < 8
        && v.human < 8;
    })?.source;

    const ctaV27 = timeline[timeline.length - 1];
    if (bestV27 && ctaV27) {
      const duration = Math.max(0.75, Number(bestV27.duration) || 0.75);
      const bounds = PACING_BOUNDS.CTA;
      const preferredStart = Number(bestV27.suggested_start);
      const preferredEnd = Number(bestV27.suggested_end);
      let start = Number.isFinite(preferredStart) ? preferredStart : 0;
      let end = Number.isFinite(preferredEnd) ? preferredEnd : start + bounds.max;

      start = clamp(start, 0, Math.max(0, duration - bounds.min));
      end = Math.min(duration, Math.max(start + bounds.min, end));
      if (end - start > bounds.max) end = start + bounds.max;
      if (end > duration) {
        end = duration;
        start = Math.max(0, end - bounds.max);
      }

      ctaV27.source_filename = String(bestV27.filename);
      ctaV27.source_start = Number(start.toFixed(3));
      ctaV27.source_end = Number(end.toFixed(3));
      ctaV27.role = 'CTA';
      ctaV27.beat_intent = 'CTA';
      ctaV27.crop_focus = 'PRODUCT';
      ctaV27.cut_on = 'REVEAL';
      ctaV27.text_style = 'CTA';
      ctaV27.text_animation = 'FADE';
      ctaV27.text_position = 'CENTER';

      const brandV27 = [
        brief?.brand_name, brief?.brand, brief?.business_name, brief?.business,
        brief?.restaurant_name, brief?.client_name,
        master?.brand_name, master?.brand, master?.business_name, master?.business,
        body?.brand_name, body?.brand, body?.business_name, body?.business,
      ].find((v: any) => typeof v === 'string' && v.trim());
      const titleV27 = String(brief?.title || master?.title || body?.title || '');
      const titleBrandV27 = titleV27.includes('—') ? titleV27.split('—')[0].trim() : titleV27.includes(' - ') ? titleV27.split(' - ')[0].trim() : '';
      const finalBrandV27 = String(brandV27 || titleBrandV27 || '').trim();
      ctaV27.text = finalBrandV27 ? `${finalBrandV27.toUpperCase()}\nVISIT TONIGHT` : 'VISIT TONIGHT';
      ctaV27.emphasis_words = ['VISIT TONIGHT'];

      // Re-sync source moment after the immutable source/window replacement.
      ctaV27.source_moment = {
        ...(ctaV27.source_moment && typeof ctaV27.source_moment === 'object' ? ctaV27.source_moment : {}),
        start: Number(clamp(Number(ctaV27?.source_moment?.start) || start, start, end).toFixed(3)),
        end: Number(clamp(Number(ctaV27?.source_moment?.end) || end, start, end).toFixed(3)),
      };

      // Do not finish a food commercial on a human reaction when a non-human
      // source can perform the penultimate payoff beat.
      if (timeline.length >= 3) {
        const penultimate = timeline[timeline.length - 2];
        const penSource = analyses.find((x: any) => String(x?.filename || '') === String(penultimate?.source_filename || ''));
        const pen = classifyCommercialVisual(penSource);
        if (pen.human >= 8) {
          const alternatives = analyses
            .filter((x: any) => String(x?.filename || '') && String(x.filename) !== String(ctaV27.source_filename) && Number(x?.duration || 0) >= 0.75)
            .map((x: any) => ({ source: x, v: classifyCommercialVisual(x) }))
            .filter(({ v }: any) => v.human < 8)
            .sort((a: any, b: any) => (b.v.hero * 2 + b.v.detail + b.v.action) - (a.v.hero * 2 + a.v.detail + a.v.action));
          const alt = alternatives[0]?.source;
          if (alt) {
            penultimate.source_filename = String(alt.filename);
            const altDuration = Math.max(0.75, Number(alt.duration) || 0.75);
            const altStart = Number.isFinite(Number(alt.suggested_start)) ? Number(alt.suggested_start) : 0;
            const altEnd = Number.isFinite(Number(alt.suggested_end)) ? Number(alt.suggested_end) : Math.min(altDuration, altStart + 1.25);
            penultimate.source_start = Number(clamp(altStart, 0, Math.max(0, altDuration - 0.25)).toFixed(3));
            penultimate.source_end = Number(clamp(Math.max(penultimate.source_start + 0.25, altEnd), penultimate.source_start + 0.25, altDuration).toFixed(3));
            penultimate.source_moment = { start: penultimate.source_start, end: penultimate.source_end };
            penultimate.crop_focus = 'PRODUCT';
          }
        }
      }

      console.warn(`[ATLAS EDIT DIRECTOR] V27 IMMUTABLE CTA | source=${ctaV27.source_filename} | score=${scoreLandingV27(bestV27).toFixed(1)} | brand=${finalBrandV27 || 'NONE'} | window=${ctaV27.source_start}-${ctaV27.source_end}`);
    }
  }
}


// V28 COMMERCIAL STORY LOCK
// Final visual-story authority for food/restaurant commercials. The AI may
// choose the creative intent, but once the footage is known, the deterministic
// layer enforces a progression of visual jobs instead of allowing several
// semantically similar prep shots to occupy the middle of the reel.
{
  const foodBriefV28 = `${JSON.stringify(brief || {})} ${JSON.stringify(master || {})}`;
  const isFoodCommercialV28 = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/i.test(foodBriefV28);

  if (isFoodCommercialV28 && timeline.length >= 6 && Array.isArray(analyses) && analyses.length >= 6) {
    const sourceTextV28 = (source: any) => [
      source?.shot_type, source?.shotType, source?.recommended_use,
      source?.reason, source?.strengths, source?.problems, source?.description,
      source?.summary, source?.subject, source?.action, source?.composition,
    ].flatMap((v: any) => Array.isArray(v) ? v : [v])
      .map((v: any) => String(v || '').toLowerCase()).join(' ');

    const scoreForFamilyV28 = (source: any, family: string, index: number) => {
      const v = classifyCommercialVisual(source);
      const t = sourceTextV28(source);
      let score = Number(source?.score || 0) * 0.8;
      const fam = v.family;
      if (fam === family) score += 70;
      if (family === 'ACTION') score += v.action * 5 - v.human * 4 + v.detail * 1;
      if (family === 'DETAIL') score += v.detail * 6 - v.human * 4 - v.action * 2;
      if (family === 'HERO') score += v.hero * 8 + v.detail * 1 - v.action * 9 - v.human * 9;
      if (family === 'HUMAN') score += v.human * 5;

      // The hook should have a visible physical event; the payoff should move
      // toward product, and the CTA is handled by the immutable V27 lock.
      if (index === 1) score += /torch|flame|fire|blowtorch|knife|cutting|slice|slicing|action peak|motion peak/i.test(t) ? 35 : 0;
      if (index === 2) score += /salmon|fish|rice|ingredient|texture|macro|detail|close[- ]?up/i.test(t) ? 30 : 0;
      if (index === 3) score += /roll|rolling|shape|assemble|craft|make|prep|chef|hands/i.test(t) ? 25 : 0;
      if (index === 4) score += /slice|slicing|cut|plating|place|plate|precision|knife/i.test(t) ? 30 : 0;
      if (index >= 5) score += /plated|finished|final dish|completed dish|hero plating|food showcase|presentation|platter|plate/i.test(t) ? 40 : 0;
      if (family !== 'HUMAN') score -= v.human * 2;
      return score;
    };

    // For an 8-beat / ~15s restaurant reel this gives the editor a concrete
    // visual arc: physical hook -> ingredient detail -> craft -> precision ->
    // escalation -> product payoff -> breathing hero -> CTA.
    const familyPlanV28 = timeline.length >= 8
      ? ['ACTION','DETAIL','ACTION','DETAIL','ACTION','HERO','HERO']
      : timeline.length === 7
        ? ['ACTION','DETAIL','ACTION','DETAIL','HERO','HERO']
        : ['ACTION','DETAIL','ACTION','DETAIL','HERO'];

    const usedV28 = new Set<string>();
    const ctaSourceV28 = String(timeline[timeline.length - 1]?.source_filename || '');

    for (let i = 0; i < Math.min(familyPlanV28.length, timeline.length - 1); i++) {
      const beat = timeline[i + 0];
      const desiredFamily = familyPlanV28[i];
      const candidates = analyses
        .filter((source: any) => {
          const filename = String(source?.filename || '');
          return filename && filename !== ctaSourceV28 && Number(source?.duration || 0) >= 0.75 && !usedV28.has(filename);
        })
        .map((source: any) => ({ source, score: scoreForFamilyV28(source, desiredFamily, i + 1) }))
        .sort((a: any, b: any) => b.score - a.score);

      const currentName = String(beat?.source_filename || '');
      const currentSource = analyses.find((x: any) => String(x?.filename || '') === currentName);
      const currentScore = currentSource ? scoreForFamilyV28(currentSource, desiredFamily, i + 1) : -Infinity;
      const replacement = candidates[0];

      // Never sacrifice a clearly strong current shot for a marginally better
      // family label. Replace only when the semantic improvement is meaningful.
      if (!replacement || replacement.score < Math.max(30, currentScore + 10)) {
        if (currentName) usedV28.add(currentName);
        continue;
      }

      const source = replacement.source;
      const duration = Math.max(0.75, Number(source?.duration) || 0.75);
      const role = String(beat?.role || 'STORY').toUpperCase();
      const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
      let start = Number(source?.suggested_start);
      let end = Number(source?.suggested_end);
      start = Number.isFinite(start) ? start : 0;
      end = Number.isFinite(end) ? end : Math.min(duration, start + Math.min(bounds.max, 1.35));
      start = clamp(start, 0, Math.max(0, duration - 0.25));
      end = clamp(Math.max(start + bounds.min, end), start + bounds.min, duration);
      if (end - start > bounds.max) end = Math.min(duration, start + bounds.max);
      if (end - start < bounds.min) {
        end = Math.min(duration, start + bounds.min);
        start = Math.max(0, end - bounds.min);
      }

      beat.source_filename = String(source.filename);
      beat.source_start = Number(start.toFixed(3));
      beat.source_end = Number(end.toFixed(3));
      beat.source_moment = { start: beat.source_start, end: beat.source_end };
      beat.crop_focus = desiredFamily === 'HERO' || desiredFamily === 'DETAIL' ? 'PRODUCT' : 'ACTION';
      usedV28.add(String(source.filename));
    }

    console.warn(
      `[ATLAS EDIT DIRECTOR] V28 COMMERCIAL STORY LOCK | families=${familyPlanV28.join('>')} | beats=${timeline.length}`,
    );
  }
}

// V31 FINAL EFFECTIVE-DURATION CONTRACT RECOVERY
// Based on V30; fixes speed-aware pacing validation without changing story/source selection.
// V28 is the story authority. This final pass may ONLY repair hard mechanical
// constraints that V28 can legitimately re-introduce: duplicate source files
// and per-beat duration bounds. It must not re-arc or reorder the story.
if (timeline.length) {
  const foodTextV29 = `${JSON.stringify(brief || {})} ${JSON.stringify(master || {})} ${JSON.stringify(raw || {})}`;
  const isFoodV29 = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/i.test(foodTextV29);
  const byNameV29 = new Map((analyses || []).map((x: any) => [String(x.filename), x]));

  if (isFoodV29 && analyses.length >= 7 && timeline.length >= 7) {
    const usedCounts = new Map<string, number>();
    for (const beat of timeline) {
      const name = String(beat?.source_filename || "");
      if (name) usedCounts.set(name, (usedCounts.get(name) || 0) + 1);
    }

    const intentFamilyV29: Record<string, string[]> = {
      HOOK_IMPACT: ["ACTION", "DETAIL", "HERO"],
      PROBLEM: ["DETAIL", "HUMAN", "ACTION"],
      ACTION: ["ACTION", "DETAIL", "HERO"],
      PROOF: ["DETAIL", "HERO", "ACTION"],
      ESCALATION: ["ACTION", "DETAIL", "HERO"],
      TRANSFORMATION: ["HERO", "DETAIL", "ACTION"],
      HERO: ["HERO", "DETAIL", "CONTEXT"],
      CTA: ["HERO", "DETAIL", "CONTEXT"],
    };

    for (let i = timeline.length - 2; i >= 1; i--) {
      const beat = timeline[i];
      const current = String(beat?.source_filename || "");
      if (!current || (usedCounts.get(current) || 0) <= 1) continue;

      const intent = String(beat?.beat_intent || beat?.role || "ACTION").toUpperCase();
      const preferred = intentFamilyV29[intent] || ["ACTION", "DETAIL", "HERO"];
      const previous = String(timeline[i - 1]?.source_filename || "");
      const next = String(timeline[i + 1]?.source_filename || "");

      let best: any = null;
      let bestScore = -Infinity;
      for (const candidate of analyses) {
        const name = String(candidate?.filename || "");
        if (!name || usedCounts.has(name)) continue;
        if (name === previous || name === next) continue;
        const cv = classifyCommercialVisual(candidate);
        const familyIndex = preferred.indexOf(cv.family);
        const familyScore = familyIndex >= 0 ? (preferred.length - familyIndex) * 100 : 0;
        const score = familyScore + cv.detail * 2 + cv.hero * 1.5 + Number(candidate?.score || 0) * 0.2 - cv.human * 1.5;
        if (score > bestScore) { bestScore = score; best = candidate; }
      }

      if (best) {
        const bestName = String(best?.filename || "");
        if (!bestName) continue;
        const sourceDuration = Math.max(0.25, Number(best.duration) || 0.25);
        const role = String(beat?.role || "STORY").toUpperCase();
        const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
        let start = Number(best.suggested_start);
        let end = Number(best.suggested_end);
        if (!Number.isFinite(start)) start = 0;
        if (!Number.isFinite(end)) end = Math.min(sourceDuration, start + bounds.max);
        start = clamp(start, 0, Math.max(0, sourceDuration - 0.25));
        end = clamp(end, start + bounds.min, sourceDuration);
        if (end - start > bounds.max) end = Math.min(sourceDuration, start + bounds.max);
        if (end - start < bounds.min) { end = Math.min(sourceDuration, start + bounds.min); start = Math.max(0, end - bounds.min); }

        usedCounts.set(current, Math.max(0, (usedCounts.get(current) || 1) - 1));
        usedCounts.set(bestName, 1);
        beat.source_filename = bestName;
        beat.source_start = Number(start.toFixed(3));
        beat.source_end = Number(end.toFixed(3));
        beat.source_moment = { start: beat.source_start, end: beat.source_end };
        beat.crop_focus = ["HERO", "DETAIL"].includes(cvFamilyForV29(best)) ? "PRODUCT" : beat.crop_focus;
      }
    }
  }

  // Final effective-duration cleanup after source assignment.
  // IMPORTANT: pacing contracts are checked after speed is applied, so
  // source-span-only clamping is insufficient when speed < 1.0.
  // Clamp the SOURCE SPAN against the role bounds * speed, then re-check
  // the effective duration. This is intentionally mechanical: no source,
  // order, intent, or story changes happen here.
  for (const beat of timeline) {
    const role = String(beat?.role || "STORY").toUpperCase();
    const bounds = PACING_BOUNDS[role] || PACING_BOUNDS.STORY;
    const source = byNameV29.get(String(beat?.source_filename || ""));
    const sourceDuration = Number(source?.duration) || 0;
    const speed = Math.max(0.5, Number(beat?.speed) || 1);

    let start = Number(beat?.source_start);
    let end = Number(beat?.source_end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    start = Math.max(0, start);
    end = Math.max(start, end);

    // Effective duration = source span / speed.
    // Therefore the legal source span is [min*speed, max*speed].
    const minSpan = bounds.min * speed;
    const maxSpan = bounds.max * speed;

    if (end - start > maxSpan) {
      end = start + maxSpan;
    }

    if (sourceDuration > 0) {
      end = Math.min(end, sourceDuration);
      start = Math.min(start, Math.max(0, sourceDuration - 0.25));
    }

    if (end - start < minSpan) {
      const needed = minSpan - (end - start);
      const roomAfter = sourceDuration > 0 ? Math.max(0, sourceDuration - end) : needed;
      end += Math.min(needed, roomAfter);

      if (end - start < minSpan) {
        const requiredStart = Math.max(0, end - minSpan);
        start = Math.min(start, requiredStart);
        end = start + minSpan;
      }
    }

    // Re-clamp to real source and max effective duration after all adjustments.
    if (sourceDuration > 0) {
      end = Math.min(end, sourceDuration);
      if (end - start > maxSpan) end = start + maxSpan;
      if (end > sourceDuration) {
        end = sourceDuration;
        start = Math.max(0, end - maxSpan);
      }
    }

    // Rounding-safe final guard: leave a tiny margin below the hard max so
    // floating-point/rounding cannot turn 1.65 into 1.680... and trip the
    // contract's +0.03 tolerance boundary.
    const safeMaxSpan = Math.max(0.01, maxSpan - 0.005);
    if (end - start > safeMaxSpan) {
      end = start + safeMaxSpan;
    }

    beat.source_start = Number(start.toFixed(3));
    beat.source_end = Number(end.toFixed(3));
    beat.source_moment = { start: beat.source_start, end: beat.source_end };
  }
}

function cvFamilyForV29(source: any) { return classifyCommercialVisual(source).family; }

// V34 FINAL TRANSITION FINISHER
// ---------------------------------------------------------------------------
// V6 is the proven creative transition candidate generator. This final pass
// deliberately DOES NOT replace strong V6 effects with CUTs. Instead it:
//   1) scores the FINAL, already-normalized timeline;
//   2) keeps strong V6 treatments;
//   3) fills missing motivated edges when the cut is too conservative;
//   4) enforces effect diversity without turning the reel into a preset demo;
//   5) validates transition windows against the actual source/effective span.
// The renderer already supports WHIP/PUNCH/ZOOM/MATCH/FLASH/FADE and SLIDE_*.
// This pass is therefore decision-only; it never changes the renderer.
{
  const finalShotsV34 = Array.isArray(timeline) ? timeline : [];
  const sourceMapV34 = new Map((analyses || []).map((x: any) => [String(x?.filename || ''), x]));
  const foodTextV34 = `${JSON.stringify(brief || {})} ${JSON.stringify(master || {})} ${JSON.stringify(raw || {})}`;
  const isFoodCommercialV34 = /(restaurant|sushi|food|dish|menu|dining|chef|cafe|bakery|pizza|burger|bar|catering|eatery)/i.test(foodTextV34);

  const familyV34 = (shot: any) => {
    const source = sourceMapV34.get(String(shot?.source_filename || ''));
    return classifyCommercialVisual(source).family;
  };
  const motionV34 = (shot: any) => String(shot?.motion || '').toUpperCase();
  const intentV34 = (shot: any) => String(shot?.beat_intent || shot?.role || '').toUpperCase();
  const sourceTextV34 = (shot: any) => {
    const source = sourceMapV34.get(String(shot?.source_filename || '')) || {};
    return [
      source?.shot_type, source?.shotType, source?.framing, source?.composition,
      source?.description, source?.summary, source?.recommended_use,
      source?.reason, source?.strengths, source?.action,
    ].flatMap((v: any) => Array.isArray(v) ? v : [v]).map((v: any) => String(v || '').toLowerCase()).join(' ');
  };

  const vectorV34 = (motion: string) => {
    if (motion === 'PAN_LEFT') return [-1, 0, 0];
    if (motion === 'PAN_RIGHT') return [1, 0, 0];
    if (motion === 'TILT_UP') return [0, -1, 0];
    if (motion === 'TILT_DOWN') return [0, 1, 0];
    if (motion === 'PUSH_IN') return [0, 0, 1];
    if (motion === 'PULL_OUT') return [0, 0, -1];
    if (motion === 'HANDHELD') return [0.35, 0.2, 0];
    if (motion === 'DRIFT') return [0.25, -0.1, 0.08];
    return [0, 0, 0];
  };
  const dotV34 = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] || 0), 0);
  const magV34 = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0));

  const effectScoreV34 = (type: string, a: any, b: any) => {
    const ma = motionV34(a), mb = motionV34(b);
    const va = vectorV34(ma), vb = vectorV34(mb);
    const maMag = magV34(va), mbMag = magV34(vb);
    const fa = familyV34(a), fb = familyV34(b);
    const ia = intentV34(a), ib = intentV34(b);
    const ta = sourceTextV34(a), tb = sourceTextV34(b);
    const sameDir = dotV34(va, vb) > 0.08;
    const motionPair = maMag + mbMag;
    const energy = [ma, mb].filter(x => x && x !== 'STATIC').length * 18
      + (/ACTION|ESCALATION|TRANSFORMATION|HOOK/.test(ia) ? 18 : 0)
      + (/ACTION|ESCALATION|TRANSFORMATION|HOOK|PAYOFF|HERO/.test(ib) ? 22 : 0)
      + (/(action peak|motion peak|reveal|transformation|impact)/i.test(`${ta} ${tb}`) ? 20 : 0);
    const heroB = fb === 'HERO' || /HERO|PAYOFF|TRANSFORMATION|PROOF/.test(ib);
    const detailPair = fa === 'DETAIL' || fb === 'DETAIL';
    const humanPair = fa === 'HUMAN' && fb === 'HUMAN';
    if (humanPair || /eating|bite|mouth|reaction/.test(tb) && /eating|bite|mouth|reaction/.test(ta)) return -999;
    if (/CTA/.test(ib)) return -999;

    let score = 0;
    if (type === 'WHIP') {
      score = 38 + Math.min(30, motionPair * 10) + (sameDir ? 18 : 4);
      if (ma === mb && ma !== 'STATIC') score += 12;
      if (/(PAN_LEFT|PAN_RIGHT)/.test(ma) && /(PAN_LEFT|PAN_RIGHT)/.test(mb)) score += 10;
      if (energy >= 35) score += 8;
    } else if (type === 'ZOOM') {
      score = 42 + (ma === 'PUSH_IN' || mb === 'PUSH_IN' ? 18 : 0) + (ma === 'PULL_OUT' || mb === 'PULL_OUT' ? 14 : 0);
      if (heroB) score += 20;
      if (detailPair) score += 12;
    } else if (type === 'MATCH') {
      score = 42 + (fa === fb ? 16 : 0) + (detailPair ? 16 : 0) + (heroB ? 12 : 0);
      if (ma === mb && ma !== 'STATIC') score += 8;
      if (/same|match|composition|scale|close|macro|overhead/i.test(`${ta} ${tb}`)) score += 14;
    } else if (type === 'PUNCH') {
      score = 40 + energy * 0.42 + (heroB ? 18 : 0) + (detailPair ? 8 : 0);
      if (fa === 'ACTION' && (fb === 'DETAIL' || fb === 'HERO')) score += 12;
    } else if (type === 'FLASH') {
      score = 30 + energy * 0.55 + (/HOOK|ESCALATION|TRANSFORMATION/.test(ib) ? 22 : 0);
      if (heroB) score += 8;
    } else if (type === 'FADE') {
      score = 28 + (/BREATH|BRIDGE|HERO|CTA/.test(ib) ? 18 : 0);
      if (fa !== fb) score += 8;
    } else if (type === 'BLUR') {
      score = 34 + (detailPair ? 20 : 0) + (heroB ? 18 : 0) + energy * 0.28;
      if (fa !== fb) score += 8;
    } else if (type === 'ROTATE') {
      score = 30 + energy * 0.45 + (sameDir ? 10 : 0);
      if (/HOOK|ESCALATION|TRANSFORMATION/.test(ib)) score += 16;
    } else if (type === 'GLITCH') {
      score = 24 + energy * 0.62 + (/HOOK|ESCALATION/.test(ib) ? 24 : 0);
      if (heroB) score += 8;
    } else if (type === 'SWIRL') {
      score = 28 + energy * 0.42 + (detailPair ? 14 : 0) + (heroB ? 14 : 0);
      if (ma !== 'STATIC' || mb !== 'STATIC') score += 8;
    } else if (type === 'LIGHT_LEAK') {
      score = 26 + energy * 0.35 + (/HERO|PAYOFF|TRANSFORMATION|BREATH/.test(ib) ? 24 : 0);
      if (fa !== fb) score += 8;
    } else if (/^SLIDE_/.test(type)) {
      score = 30 + Math.min(25, motionPair * 8) + (sameDir ? 14 : 3);
      if (fa !== fb) score += 8;
    }
    return score;
  };

  // First restore the proven V6 creative layer on the FINAL timeline.
  // This is intentionally before any extra finishing logic so V6 remains the
  // source of truth for candidate quality rather than a new preset generator.
  let directedV34 = repairTransitionIntelligence(finalShotsV34, analyses);

  // Re-read V6's selected effects and keep them unless a hard safety rule
  // invalidates the edge. We then fill only genuinely strong missing edges.
  const effectOrderV34 = ['WHIP', 'MATCH', 'ZOOM', 'PUNCH', 'FLASH', 'BLUR', 'ROTATE', 'GLITCH', 'SWIRL', 'LIGHT_LEAK', 'SLIDE_LEFT', 'SLIDE_RIGHT', 'SLIDE_UP', 'SLIDE_DOWN', 'FADE'];
  const maxEffectsV34 = isFoodCommercialV34
    ? Math.min(6, Math.max(4, directedV34.length - 2))
    : Math.min(6, Math.max(4, directedV34.length - 1));
  const minScoreV34 = isFoodCommercialV34 ? 60 : 58;
  const usedTypesV34 = new Map<string, number>();

  const isSafeEdgeV34 = (i: number, type: string) => {
    const prev = directedV34[i - 1];
    const next = directedV34[i];
    if (!prev || !next || type === 'CUT') return false;
    const intent = intentV34(next);
    if (/CTA/.test(intent)) return false;
    if (familyV34(prev) === 'HUMAN' && familyV34(next) === 'HUMAN') return false;
    const source = sourceMapV34.get(String(next?.source_filename || ''));
    const span = Math.max(0.05, Number(next?.source_end || 0) - Number(next?.source_start || 0));
    const speed = Math.max(0.5, Number(next?.speed) || 1);
    const effective = span / speed;
    const requested = type === 'WHIP' ? 0.14 : type === 'PUNCH' ? 0.12 : type === 'FLASH' ? 0.10 : type === 'GLITCH' ? 0.10 : type === 'BLUR' ? 0.11 : 0.12;
    if (effective <= requested + 0.08) return false;
    if (!source) return false;
    return true;
  };

  // Count and preserve the existing V6 decisions.
  for (let i = 1; i < directedV34.length; i++) {
    const t = String(directedV34[i]?.transition_in || 'CUT').toUpperCase();
    if (t !== 'CUT') usedTypesV34.set(t, (usedTypesV34.get(t) || 0) + 1);
  }

  // Safety + quality normalization of preserved V6 transitions.
  for (let i = 1; i < directedV34.length; i++) {
    const shot = directedV34[i];
    const type = String(shot?.transition_in || 'CUT').toUpperCase();
    if (type === 'CUT') continue;
    if (!isSafeEdgeV34(i, type)) {
      shot.transition_in = 'CUT';
      directedV34[i - 1].transition_out = 'CUT';
      usedTypesV34.set(type, Math.max(0, (usedTypesV34.get(type) || 1) - 1));
      continue;
    }
    const requested = type === 'WHIP' ? 0.14 : type === 'PUNCH' ? 0.12 : type === 'FLASH' ? 0.10 : type === 'GLITCH' ? 0.10 : type === 'BLUR' ? 0.11 : 0.12;
    const prev = directedV34[i - 1];
    const spanA = Math.max(0.05, (Number(prev?.source_end || 0) - Number(prev?.source_start || 0)) / Math.max(0.5, Number(prev?.speed) || 1));
    const spanB = Math.max(0.05, (Number(shot?.source_end || 0) - Number(shot?.source_start || 0)) / Math.max(0.5, Number(shot?.speed) || 1));
    const maxDur = Math.min(requested, spanA * 0.35, spanB * 0.35);
    shot.transition_duration = Number(Math.max(0.08, maxDur).toFixed(3));
    prev.transition_out = type;
  }

  let selectedV34 = 0;
  for (let i = 1; i < directedV34.length; i++) {
    if (String(directedV34[i]?.transition_in || 'CUT').toUpperCase() !== 'CUT') selectedV34++;
  }

  // If V6 was too conservative after the later source/story locks, fill the
  // strongest remaining edges. This uses different effects intentionally and
  // never forces a transition just to hit a quota.
  if (selectedV34 < maxEffectsV34) {
    const candidates: Array<{ index: number; type: string; score: number; direction: string }> = [];
    for (let i = 1; i < directedV34.length; i++) {
      if (String(directedV34[i]?.transition_in || 'CUT').toUpperCase() !== 'CUT') continue;
      const prev = directedV34[i - 1], next = directedV34[i];
      const va = vectorV34(motionV34(prev)), vb = vectorV34(motionV34(next));
      const dir = (va[0] + vb[0]) >= 0 ? 'RIGHT' : 'LEFT';
      for (const type of effectOrderV34) {
        const score = effectScoreV34(type, prev, next);
        if (score >= minScoreV34 && isSafeEdgeV34(i, type)) candidates.push({ index: i, type, score, direction: dir });
      }
    }
    candidates.sort((a, b) => b.score - a.score || a.index - b.index);
    const occupied = new Set<number>();
    for (const c of candidates) {
      if (selectedV34 >= maxEffectsV34) break;
      if (occupied.has(c.index)) continue;
      const prev = directedV34[c.index - 1], next = directedV34[c.index];
      const prevType = String(prev?.transition_out || 'CUT').toUpperCase();
      if (prevType !== 'CUT') continue;
      // Keep adjacent transitions varied; no type can dominate the reel.
      if ((usedTypesV34.get(c.type) || 0) >= 2) continue;
      if (c.type === 'PUNCH' && /CTA/.test(intentV34(next))) continue;
      if (c.type === 'FLASH' && !/HOOK|ESCALATION|TRANSFORMATION/.test(intentV34(next))) continue;
      if (/^SLIDE_/.test(c.type) && isFoodCommercialV34 && familyV34(next) === 'HERO') continue;

      const spanA = Math.max(0.05, (Number(prev?.source_end || 0) - Number(prev?.source_start || 0)) / Math.max(0.5, Number(prev?.speed) || 1));
      const spanB = Math.max(0.05, (Number(next?.source_end || 0) - Number(next?.source_start || 0)) / Math.max(0.5, Number(next?.speed) || 1));
      const baseDur = c.type === 'WHIP' ? 0.14 : c.type === 'PUNCH' ? 0.12 : c.type === 'FLASH' ? 0.10 : c.type === 'GLITCH' ? 0.10 : c.type === 'BLUR' ? 0.11 : 0.12;
      const duration = Math.max(0.08, Math.min(baseDur, spanA * 0.35, spanB * 0.35));
      prev.transition_out = c.type;
      next.transition_in = c.type;
      next.transition_score = Number(c.score.toFixed(1));
      next.transition_confidence = Number(Math.min(0.99, c.score / 100).toFixed(2));
      next.transition_direction = c.direction;
      next.transition_duration = Number(duration.toFixed(3));
      next.transition_reason = `PRO motivated ${c.type.toLowerCase()} | ${familyV34(prev)}→${familyV34(next)} | ${motionV34(prev)}→${motionV34(next)}`;
      usedTypesV34.set(c.type, (usedTypesV34.get(c.type) || 0) + 1);
      occupied.add(c.index);
      selectedV34++;
    }
  }

  // Final invariants: CTA is a clean landing; every selected effect has a
  // mirrored outgoing/incoming declaration; transition windows are short and
  // render-safe. No transition may be repeated more than twice in the final cut.
  for (let i = 1; i < directedV34.length; i++) {
    const prev = directedV34[i - 1];
    const next = directedV34[i];
    let type = String(next?.transition_in || 'CUT').toUpperCase();
    if (/CTA/.test(intentV34(next))) type = 'CUT';
    if (!isSafeEdgeV34(i, type)) type = 'CUT';
    if (type !== 'CUT' && (usedTypesV34.get(type) || 0) > 2) type = 'CUT';
    next.transition_in = type;
    prev.transition_out = type;
    if (type === 'CUT') {
      delete next.transition_reason;
      delete next.transition_score;
      delete next.transition_confidence;
      delete next.transition_direction;
      delete next.transition_duration;
    }
  }

  selectedV34 = directedV34.slice(1).filter((x: any) => String(x?.transition_in || 'CUT').toUpperCase() !== 'CUT').length;
  timeline = directedV34;
  console.warn(
    `[ATLAS TRANSITION DIRECTOR V34 FINAL] edges=${Math.max(0, timeline.length - 1)} selected=${selectedV34} ` +
    `effects=${Array.from(new Set(timeline.slice(1).map((x: any) => String(x?.transition_in || 'CUT').toUpperCase()).filter((x: string) => x !== 'CUT'))).join(',') || 'CUT ONLY'} ` +
    `commercial=${isFoodCommercialV34}`,
  );
}

contract = checkContracts(timeline);
if (contract.failed) {
  throw new Error(
    `Final deterministic editorial contract failed: ${[
      contract.diversityFailed
        ? `source diversity ${contract.unique}/${contract.diversityTarget}`
        : "",
      ...contract.pacing.violations,
      ...contract.editorial.violations,
    ].filter(Boolean).join(" | ")}`,
  );
}

    const editPlan = buildV2EditPlan(
      raw,
      timeline,
      brief,
      master,
      analyses,
      captions,
      targetDuration,
    );

    const uniqueSources = new Set(
      timeline.map((x) => String(x.source_filename)),
    ).size;

    const sameAdjacent = timeline.filter(
      (x, i) => i > 0 && x.source_filename === timeline[i - 1].source_filename,
    ).length;

    // Strict invariant: repair must actually succeed. Never silently degrade
    // or accept an invalid timeline after deterministic repair.
    if (sameAdjacent > 0) {
      throw new Error("AI Edit Director produced adjacent duplicate sources after deterministic repair.");
    }

    if (uniqueSources < Math.min(4, analyses.length)) {
      console.warn(
        `[ATLAS EDIT DIRECTOR] low source diversity: ${uniqueSources}/${Math.min(4, analyses.length)}`,
      );
    }

    return NextResponse.json({
      success: true,
      version: "2.0",
      edit_plan_version: editPlan.version,
      edit_plan: editPlan,
      editorial_intent: String(raw.editorial_intent || ""),
      hook_strategy: String(raw.hook_strategy || ""),
      music_strategy: String(raw.music_strategy || ""),
      moment_engine: {
        candidateCount: momentCandidates.length,
        selectedCount: timeline.filter((beat) => Boolean(String(beat?.moment_candidate_id || ""))).length,
        selectedCandidateIds: timeline.map((beat) => String(beat?.moment_candidate_id || "")).filter(Boolean),
      },
      decision_engine: {
        candidateId: decisionCandidate?.id || null,
        score: decisionCandidate?.score ?? null,
        uniqueSources: decisionCandidate?.uniqueSources ?? null,
        totalDuration: decisionCandidate?.totalDuration ?? null,
        rationale: decisionCandidate?.rationale?.slice(0, 16) || [],
      },
      best_cut_search: bestCutCandidate
        ? {
            candidateId: bestCutCandidate.id,
            score: bestCutCandidate.score,
            breakdown: bestCutCandidate.breakdown,
            rationale: bestCutCandidate.rationale,
            variantCount: optimizedVariants.length,
          }
        : null,
      timeline,
      transitions: timeline
        .map((beat: any, index: number) => ({
          edge: index > 0 ? `${index - 1}->${index}` : null,
          type: String(beat?.transition_in || "CUT"),
          score: beat?.transition_score ?? null,
          reason: beat?.transition_reason ?? null,
          direction: beat?.transition_direction ?? null,
          duration: beat?.transition_duration ?? null,
        }))
        .filter((x: any) => x.edge && x.type !== "CUT"),
      transitionEdgeCount: timeline.reduce((count: number, beat: any, index: number) =>
        count + (index > 0 && String(beat?.transition_in || "CUT").toUpperCase() !== "CUT" ? 1 : 0), 0),
      quality: {
        uniqueSources,
        beats: timeline.length,
        adjacentDuplicateSources: sameAdjacent,
        targetDuration: targetDuration,
        actualDuration: Number(
          timeline
            .reduce(
              (sum, beat) =>
                sum +
                Math.max(
                  0,
                  Number(beat.source_end) - Number(beat.source_start),
                ),
              0,
            )
            .toFixed(2),
        ),
      },
    });
  } catch (error: any) {
    console.error("ATLAS AI EDIT DIRECTOR V2 ERROR", error);
    return NextResponse.json(
      { error: error?.message || "AI Edit Director failed." },
      { status: 500 },
    );
  }
}
