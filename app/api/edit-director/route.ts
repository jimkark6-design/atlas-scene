import OpenAI from "openai";
import { NextResponse } from "next/server";

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
          "id","source_filename","source_start","source_end","role","purpose",
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

function normalizeTimeline(rawTimeline: any[], analyses: any[], targetDuration: number) {
  const byName = new Map(analyses.map((x: any) => [String(x.filename), x]));
  const usedWindows = new Set<string>();
  const result: any[] = [];

  for (const item of rawTimeline || []) {
    const src: any = byName.get(String(item?.source_filename || ""));
    if (!src) continue;

    const duration = Number(src.duration) || 0;
    if (duration < 0.25) continue;

    const start = clamp(Number(item.source_start) || 0, 0, Math.max(0, duration - 0.20));
    const end = clamp(
      Number(item.source_end) || Math.min(duration, start + 1.2),
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
      role: ["HOOK","STORY","PAYOFF","CTA"].includes(String(item.role)) ? item.role : "STORY",
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
    .map((x, index) => ({ role: String(x.role || "").toUpperCase(), index }))
    .filter((x) => x.role === "CTA")
    .map((x) => x.index);

  if (ctaIndexes.length !== 1) {
    throw new Error(
      `AI Edit Director must produce exactly one CTA beat; found ${ctaIndexes.length}. Regenerate the timeline.`,
    );
  }

  const ctaIndex = ctaIndexes[0];
  if (ctaIndex !== result.length - 1) {
    const [cta] = result.splice(ctaIndex, 1);
    result.push(cta);
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

    const prompt = `You are ATLAS AI EDIT DIRECTOR V3 — a senior commercial editor, trailer editor and short-form retention specialist.

Your output is the executable creative timeline. The renderer will obey it literally. Do not produce a generic montage.

ARCHITECTURE
- Master Director = WHY / business story.
- Vision = WHAT exists in the real footage.
- You = HOW the edit feels: exact source windows, rhythm, cuts, motion, typography, sound cues and grade.
- Renderer = deterministic execution only.

QUALITY TARGET
The user should watch the finished Reel and immediately think: “This was edited by a real professional.”

EDITORIAL RULES
1. HOOK: first 0.0–0.9s must be the strongest visual moment. Prefer action, texture, contrast, transformation or an unusual detail. Never spend the opening establishing the scene unless it is genuinely exceptional.
2. RHYTHM: for ~15s use 7–10 meaningful beats when footage supports it. Typical beat 0.65–1.9s. Hero 1.5–2.6s. CTA 2.0–3.2s. Do not stretch weak footage to hit duration.
3. CUT ON SOMETHING: every cut should be motivated by ACTION_PEAK, MOTION_MATCH, WORD_EMPHASIS, MUSIC_BEAT, REVEAL or BREATH. Do not cut merely because a clip ended.
4. SEQUENCE: build escalation. A strong default for service footage is HOOK → PROBLEM → ACTION → PROOF → ESCALATION → TRANSFORMATION → HERO → CTA, but rebuild when the real footage demands it.
5. SOURCE SELECTION: choose the strongest moment inside each real source, not arbitrary starts. Never invent timestamps. Never repeat the same exact window. Avoid adjacent same-source beats.
6. VISUAL VARIETY: deliberately alternate composition, scale and motion. Do not make every beat a push-in. Use static beauty shots when they are stronger than motion.
7. MOTION: zoom_start/zoom_end are intentional camera decisions. PUSH_IN should normally increase scale, PULL_OUT decrease, pans should be reserved for directional movement.
8. TRANSITIONS: CUT is dominant. Use MATCH/WHIP/PUNCH/FLASH/ZOOM only when the visual handoff earns it. Maximum 2 non-CUT transitions in a 15s cut unless the concept truly requires more.
9. TEXT: typography is a designed hierarchy. Usually text on HOOK + one proof/value beat + CTA, not every shot. Keep it short enough to read at phone speed. Never invent claims.
10. AUDIO: if source audio contains useful physical sound, preserve it selectively. Voice wins. Music supports. SFX should land on visible actions or editorial impacts.
11. COLOR: choose a per-shot color_treatment such as NATURAL, CLEAN_PREMIUM, CRISP_DETAIL, DARK_LUXURY, PUNCHY, WARM, or COOL. The grade must support the material; do not make every shot look identical.
12. CTA: when the brief has a booking/purchase/contact objective, you MUST output exactly ONE beat with role=CTA. It MUST be the final timeline beat and use the strongest clean hero frame with enough reading time. Never omit CTA, never label PAYOFF as CTA, and never finish on PAYOFF.
13. BEAT COUNT: for a ~15s reel, output 7–10 distinct executable beats. If a candidate is weak, replace it with another real source window; do not reduce the timeline to 5 beats.
14. NO TEMPLATE FEEL: never use identical motion + text + SFX patterns repeatedly. Every beat needs a distinct editorial job.

SFX VOCABULARY
HOOK_IMPACT, WHOOSH, WATER, FOAM, WIPE, MACHINE, REVEAL_IMPACT, CTA_HIT, CLICK, POP, NONE. Use 0–2 cues per beat.

REVISION RULE
If REVIEW is present, treat it as a real editorial note from a senior reviewer. Fix the specific failure, not just the metadata. Prefer a materially better first second, stronger action peaks, better rhythm, cleaner typography and stronger payoff over cosmetic changes. Never make a revision merely different; make it better.

${revisionContext}

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
- 7–10 beats for a usable ~15s source set
- exactly one CTA beat exists and it is the final beat
- no adjacent duplicate source
- no exact repeated source window
- at least 4 unique source files when available
- CTA is last when required
- total visual duration is within 90–103% of target when enough footage exists
- at least 3 distinct motion treatments when footage supports it
- no more than 2 non-CUT transitions unless strongly justified
- text is sparse and readable
- SFX are motivated by visible action
- no invented claims

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

    try {
      raw = await createPlan();
      timeline = normalizeTimeline(
        Array.isArray(raw.timeline) ? raw.timeline : [],
        analyses,
        targetDuration,
      );
    } catch (error: any) {
      const message = String(error?.message || error || "");

      // Exactly one targeted regeneration is allowed for CTA contract failure.
      // The regenerated plan is passed through normalizeTimeline again, so the
      // strict CTA/source/timing validation is never bypassed.
      if (!message.includes("exactly one CTA")) throw error;

      console.warn("[ATLAS EDIT DIRECTOR] CTA contract failed; targeted regeneration 1/1");
      raw = await createPlan(
        "Regenerate the entire timeline. The previous response violated the CTA contract. Output exactly one beat with role=CTA, and it must be the final beat. Do not omit CTA and do not relabel another role after generation.",
      );
      timeline = normalizeTimeline(
        Array.isArray(raw.timeline) ? raw.timeline : [],
        analyses,
        targetDuration,
      );
    }

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
      editorial_intent: String(raw.editorial_intent || ""),
      hook_strategy: String(raw.hook_strategy || ""),
      music_strategy: String(raw.music_strategy || ""),
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
