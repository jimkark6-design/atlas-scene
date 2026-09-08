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
  const nonCta = timeline.filter((_, index) => index !== ctaIndex);

  if (!cta) {
    return repairSequence(nonCta, "");
  }

  if (nonCta.length === 0) return [cta];
  return [...repairSequence(nonCta, String(cta.source_filename)), cta];
}

function repairSequence(items: any[], blockedFinalSource: string) {
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

  if (result.length < 7) {
    throw new Error(
      `AI Edit Director produced only ${result.length} valid beats after normalization; expected at least 7. Regenerate instead of degrading the edit.`,
    );
  }

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
    throw new Error(
      `AI Edit Director produced a destructive ${finalTotal.toFixed(2)}s timeline for a ${target.toFixed(2)}s target.`,
    );
  }

  return repaired;
}


const PACING_BOUNDS: Record<string, { min: number; max: number }> = {
  HOOK: { min: 0.80, max: 1.50 },
  STORY: { min: 0.65, max: 1.90 },
  PAYOFF: { min: 1.50, max: 2.80 },
  CTA: { min: 2.00, max: 3.00 },
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
  if (nonCut > 2) {
    violations.push(`too many non-CUT transitions: ${nonCut}; maximum 2`);
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
    const duration = Math.max(
      0,
      Number(beat?.source_end || 0) - Number(beat?.source_start || 0),
    );
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
      .sort((a: any, b: any) => Number(b?.score || 0) - Number(a?.score || 0));

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

  return repairSourceDiversityAndMotion(repaired, analyses);
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

function mapRelationship(beat: any, index: number) {
  if (index === 0) return { relationship: "STANDALONE", relationshipTo: undefined };
  const cutOn = String(beat?.cut_on || "").toUpperCase();
  const previousId = `beat-${index}`;
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
    const relationship = mapRelationship(beat, index);
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
      maxNonCutTransitions: 2,
      maxTextBeats: 3,
      maxAdjacentSameSource: 0,
    },
  };

  assertExecutableTimeline(plan, sourceAssets);
  return plan;
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
8. TRANSITIONS: CUT is dominant. Use MATCH/WHIP/PUNCH/FLASH/ZOOM only when the visual handoff earns it. Maximum 2 non-CUT transitions in a 15s cut unless the concept truly requires more.
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
- 7-10 beats for a usable ~15s source set
- exactly one CTA beat exists and it is the final beat
- no adjacent duplicate source
- no exact repeated source window
- at least 4 unique source files when available
- CTA is last when required
- total visual duration is within 90-103% of target when enough footage exists
- at least 3 distinct motion treatments when footage supports it
- no more than 2 non-CUT transitions unless strongly justified
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

    const normalizeRawTimeline = (plan: any) =>
      normalizeTimeline(
        Array.isArray(plan?.timeline) ? plan.timeline : [],
        analyses,
        targetDuration,
        momentCandidates,
      );

raw = await createPlan();

    // Decision Engine pass: search several plausible moment assignments
    // against the AI's editorial skeleton, then keep the highest-scoring path.
    decisionCandidate = searchBestEditCandidate(
      Array.isArray(raw?.timeline) ? raw.timeline : [],
      momentCandidates,
      targetDuration,
      {
        beamWidth: 8,
        candidatesPerBeat: 5,
        maxSourceReuse: 2,
      },
    );

    raw = {
      ...raw,
      timeline: decisionCandidate.timeline,
    };

    timeline = normalizeRawTimeline(raw);

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
- HOOK: 0.80-1.50s
- STORY: 0.65-1.90s
- PAYOFF: 1.50-2.80s
- CTA: 2.00-3.00s

HARD EDITORIAL LIMITS:
- maximum 3 text beats
- exactly 1 CTA
- CTA must be final
- at least 1 PAYOFF/HERO/TRANSFORMATION
- at least 1 ESCALATION when there are 7+ beats
- at least 3 distinct motion treatments when enough footage exists
- maximum 2 non-CUT transitions
- consecutive beats must not be visually/editorially redundant
- use distinct source filenames when available

REPAIR STRATEGY:
1. Identify the exact beats causing the reported violations.
2. Preserve all unaffected beats exactly unless changing them is strictly necessary.
3. For pacing violations, adjust ONLY the affected source_start/source_end.
4. For text density, remove text from the weakest affected text beats; never remove HOOK or CTA text.
5. For motion variety, change motion on suitable non-CTA beats only.
6. For source diversity, replace only duplicate-source beats when an unused real source exists.
7. For CTA duration, keep CTA between 2.00s and 3.00s. NEVER output a CTA longer than 3.00s.
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

if (contract.failed) {
  throw new Error(
    `AI Edit Director editorial contract failed after ${MAX_REPAIR_ATTEMPTS} bounded repair attempts: ${[
      contract.diversityFailed
        ? `source diversity ${contract.unique}/${contract.diversityTarget}`
        : "",
      ...contract.pacing.violations,
      ...contract.editorial.violations,
    ]
      .filter(Boolean)
      .join(" | ")}`,
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
      timeline,
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
