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
      minItems: 5,
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
        },
        required: [
          "id","source_filename","source_start","source_end","role","purpose",
          "cut_reason","transition_in","transition_out","motion","zoom_start",
          "zoom_end","speed","text","text_style","text_animation","text_position",
          "emphasis_words","sfx","sfx_events","source_audio_volume","music_volume",
          "color_treatment","crop_focus","editorial_score",
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

function normalizeTimeline(rawTimeline: any[], analyses: any[], targetDuration: number) {
  const byName = new Map(analyses.map((x: any) => [String(x.filename), x]));
  const usedWindows = new Set<string>();
  const usedSources = new Set<string>();
  const result: any[] = [];

  for (const item of rawTimeline || []) {
    const src: any = byName.get(String(item?.source_filename || ""));
    if (!src) continue;

    const duration = Number(src.duration) || 0;
    if (duration < 0.25) continue;

    let start = clamp(Number(item.source_start) || 0, 0, Math.max(0, duration - 0.20));
    let end = clamp(
      Number(item.source_end) || Math.min(duration, start + 1.2),
      start + 0.25,
      duration,
    );

    const sig = `${item.source_filename}|${start.toFixed(2)}|${end.toFixed(2)}`;
    if (usedWindows.has(sig)) continue;

    // Never allow adjacent reuse unless the clip is explicitly a different source window.
    const previous = result[result.length - 1];
    if (previous?.source_filename === String(item.source_filename)) {
      const previousEnd = Number(previous.source_end);
      if (Math.abs(start - previousEnd) < 0.35) {
        continue;
      }
    }

    usedWindows.add(sig);
    usedSources.add(String(item.source_filename));

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
      sfx_events: Array.isArray(item.sfx_events)
        ? item.sfx_events.slice(0, 3).map((e: any) => ({
            type: String(e?.type || "NONE"),
            at: Math.max(0, Number(e?.at) || 0),
            volume: clamp(Number(e?.volume) || 0.12, 0, 1),
          }))
        : [],
    });
  }

  if (result.length < 5) {
    throw new Error("AI Edit Director did not produce at least 5 valid editorial beats.");
  }

  // CTA must be last. If the AI produced one earlier, move that beat to the end.
  const ctaIndex = result.findIndex((x) => String(x.role).toUpperCase() === "CTA");
  if (ctaIndex >= 0 && ctaIndex !== result.length - 1) {
    const [cta] = result.splice(ctaIndex, 1);
    result.push(cta);
  }

  // Keep the final beat long enough to function as a real payoff/CTA.
  const target = clamp(Number(targetDuration) || 15, 8, 60);
  const total = result.reduce(
    (sum, x) => sum + Math.max(0, Number(x.source_end) - Number(x.source_start)),
    0,
  );

  // If the AI undershot the target, extend later beats only when the real source has room.
  if (total < target * 0.90) {
    let remaining = target - total;
    for (let i = result.length - 1; i >= 0 && remaining > 0.02; i--) {
      const shot = result[i];
      const src: any = byName.get(shot.source_filename);
      const sourceDuration = Number(src?.duration) || Number(shot.source_end);
      const room = Math.max(0, sourceDuration - Number(shot.source_end));
      const desired = i === result.length - 1 ? Math.max(0.8, remaining) : remaining;
      const add = Math.min(room, desired);
      if (add > 0) {
        shot.source_end = Number((Number(shot.source_end) + add).toFixed(3));
        remaining -= add;
      }
    }
  }

  // If still materially short, fail rather than silently producing a destructive short edit.
  const finalTotal = result.reduce(
    (sum, x) => sum + Math.max(0, Number(x.source_end) - Number(x.source_start)),
    0,
  );

  if (finalTotal < target * 0.90) {
    throw new Error(
      `AI Edit Director produced a destructive ${finalTotal.toFixed(2)}s timeline for a ${target.toFixed(2)}s target.`,
    );
  }

  return result;
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

    const prompt = `You are ATLAS AI EDIT DIRECTOR V2 — a senior short-form commercial editor.

Your output is NOT a shot list and NOT a suggestion.
It is the executable creative timeline that a deterministic renderer will obey.

ARCHITECTURE
- Master Director decides the business objective, story and creative strategy.
- Vision decides what is actually present in the footage.
- YOU decide the exact editorial sequence, timing, source windows, motion, typography, transitions and sound cues.
- The renderer must not invent creative decisions that are absent from your timeline.

TARGET
${targetDuration.toFixed(2)} seconds, vertical 9:16.

NON-NEGOTIABLE EDITORIAL RULES

1. HOOK
- The first 0.0–1.2s must contain the strongest scroll-stopping visual.
- Prefer visible action, contrast, transformation, texture or a clear problem.
- Do not waste the opening on a generic establishing shot.

2. STORY CHOREOGRAPHY
For service/detailing content prefer:
HOOK → ACTION → PROOF/DETAIL → ESCALATION → TRANSFORMATION → HERO → CTA.
For other businesses adapt the same principle: every beat must add information.

3. BEAT COUNT
- Target 7–10 meaningful beats for a 15s Reel when footage supports it.
- Most beats: 0.7–2.0s.
- Hook: normally <=1.2s.
- Process/detail: normally <=2.2s.
- Hero: 1.8–2.8s.
- CTA: 2.0–3.2s.

4. SOURCE SELECTION
- Use exact source_start/source_end from real clips.
- Choose action peaks, not arbitrary middle sections.
- Never repeat the same exact source window.
- Never put the same source in adjacent beats when alternatives exist.
- Prefer visual variety: wide/detail/action/beauty.
- Reuse a source only for a genuinely different moment or editorial purpose.

5. CTA / HERO LOCK
- If the brief has a CTA, CTA MUST be the final beat.
- The final beat should use the strongest available finished/hero visual.
- Never end on a weak process shot when a stronger finished result exists.
- Reserve enough hold time for the CTA to actually land.

6. MOTION
- Motion must support the visual action.
- Do NOT give every clip PUSH_IN.
- Use STATIC for strong shots that need to breathe.
- Use PUSH_IN/PULL_OUT/PAN/TILT/HANDHELD only when motivated.

7. TRANSITIONS
- CUT is the default.
- Use WHIP/MATCH/ZOOM/PUNCH/FLASH/SLIDE only when visually motivated.
- Never spam transitions.

8. TEXT
- Text is editorial design, not a label on every shot.
- Use text only for hook, benefit, proof, offer or CTA.
- Keep typography sparse and deliberate.
- CTA text must match the actual objective in the brief.
- Never invent claims, prices, offers, guarantees or business facts.

9. AUDIO
- SFX must correspond to visible physical actions.
- Voice has priority when present.
- Music supports rhythm and ducks under important action/voice.
- Never add random generic beeps.

10. PROFESSIONALISM
The result must feel like a real commercial/social editor made it.
Avoid slideshow structure, identical shots, identical zooms, generic text on every clip and meaningless transitions.

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
- first beat is the strongest hook
- no adjacent duplicate source
- at least 5 meaningful beats
- final CTA is last when required
- final visual is a true payoff
- total source duration is close to target
- no invented claims
- motion/transition choices have reasons

Return ONLY JSON matching the schema.`;

    const response = await openai.responses.create({
      model: "gpt-5.4-mini",
      store: false,
      input: [{ role: "user", content: prompt }],
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

    const raw = JSON.parse(response.output_text);

    const timeline = normalizeTimeline(
      Array.isArray(raw.timeline) ? raw.timeline : [],
      analyses,
      targetDuration,
    );

    const uniqueSources = new Set(
      timeline.map((x) => String(x.source_filename)),
    ).size;

    const sameAdjacent = timeline.filter(
      (x, i) => i > 0 && x.source_filename === timeline[i - 1].source_filename,
    ).length;

    if (sameAdjacent > 0) {
      throw new Error("AI Edit Director produced adjacent duplicate sources.");
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
