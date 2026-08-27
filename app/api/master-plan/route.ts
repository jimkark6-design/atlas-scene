import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ClipAnalysis = {
  clip: number;
  filename: string;
  duration?: number;
  score: number;
  verdict: string;
  shot_type: string;
  reason: string;
  strengths?: string[];
  problems?: string[];
  recommended_use?: string;
  suggested_start?: number;
  suggested_end?: number;
};

type CaptionWord = {
  word: string;
  start: number;
  end: number;
};

type CaptionSegment = {
  id: string;
  filename: string;
  start: number;
  end: number;
  text: string;
  words?: CaptionWord[];
};

type MasterShot = {
  id: string;
  role: "HOOK" | "STORY" | "PAYOFF" | "CTA";
  source_filename: string;
  start: number;
  end: number;
  purpose: string;
  visual_action: string;
  editorial_score: number;
  selection_reason: string;
  speech_segment_ids: string[];
  speech_text: string;
  visual_treatment: string;
  crop: "NONE" | "CENTER" | "FACE" | "PRODUCT" | "ACTION";
  zoom: number;
  speed?: number;
  motion?: string;
  transition_in: "CUT" | "DISSOLVE" | "WHIP" | "MATCH" | "ZOOM" | "PUNCH" | "SLIDE_LEFT" | "SLIDE_RIGHT" | "SLIDE_UP" | "SLIDE_DOWN" | "FLASH" | "NONE";
  transition_out: "CUT" | "DISSOLVE" | "WHIP" | "MATCH" | "ZOOM" | "PUNCH" | "SLIDE_LEFT" | "SLIDE_RIGHT" | "SLIDE_UP" | "SLIDE_DOWN" | "FLASH" | "NONE";
  on_screen_text: string;
  caption_mode: "NONE" | "WORD_BY_WORD" | "PHRASE";
  caption_emphasis: string[];
  music_intensity: number;
  voice_priority: number;
  text_style: string;
  text_animation: string;
  text_position: string;
  sfx: string[];
};

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

const masterPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    objective: { type: "string" },
    audience_takeaway: { type: "string" },
    core_message: { type: "string" },
    editorial_strategy: { type: "string" },
    brief_alignment: { type: "string" },
    target_duration_seconds: { type: "number" },
    script: {
      type: "object",
      additionalProperties: false,
      properties: {
        hook: { type: "string" },
        setup: { type: "string" },
        development: { type: "string" },
        payoff: { type: "string" },
        ending: { type: "string" },
      },
      required: ["hook", "setup", "development", "payoff", "ending"],
    },
    global_audio: {
      type: "object",
      additionalProperties: false,
      properties: {
        music_mood: { type: "string" },
        music_intensity: { type: "number" },
        voice_priority: { type: "number" },
        duck_music_under_speech: { type: "boolean" },
        target_lufs: { type: "number" },
      },
      required: [
        "music_mood",
        "music_intensity",
        "voice_priority",
        "duck_music_under_speech",
        "target_lufs",
      ],
    },
    global_captions: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        style: { type: "string" },
        max_words_per_chunk: { type: "integer" },
        emphasis_words: { type: "array", items: { type: "string" } },
        position: { type: "string" },
      },
      required: [
        "enabled",
        "style",
        "max_words_per_chunk",
        "emphasis_words",
        "position",
      ],
    },
    remake: {
      type: "object",
      additionalProperties: false,
      properties: {
        decision: {
          type: "string",
          enum: ["KEEP", "ADAPT", "REBUILD"],
        },
        summary: { type: "string" },
        what_survives_from_ideal: {
          type: "array",
          items: { type: "string" },
        },
        what_changed: {
          type: "array",
          items: { type: "string" },
        },
        missing_ideal_shots: {
          type: "array",
          items: { type: "string" },
        },
        footage_strengths: {
          type: "array",
          items: { type: "string" },
        },
        footage_problems: {
          type: "array",
          items: { type: "string" },
        },
        voice: {
          type: "object",
          additionalProperties: false,
          properties: {
            needed: { type: "boolean" },
            source: {
              type: "string",
              enum: ["USER_RECORDING", "AI_VOICE", "NONE"],
            },
            reason: { type: "string" },
            script: { type: "string" },
          },
          required: ["needed", "source", "reason", "script"],
        },
        revised_timeline: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              beat_id: { type: "string" },
              start: { type: "number" },
              end: { type: "number" },
              purpose: { type: "string" },
              source_filename: { type: "string" },
              reason_for_change: { type: "string" },
            },
            required: [
              "beat_id",
              "start",
              "end",
              "purpose",
              "source_filename",
              "reason_for_change",
            ],
          },
        },
      },
      required: [
        "decision",
        "summary",
        "what_survives_from_ideal",
        "what_changed",
        "missing_ideal_shots",
        "footage_strengths",
        "footage_problems",
        "voice",
        "revised_timeline",
      ],
    },
    shots: {
      type: "array",
      minItems: 6,
      maxItems: 9,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          role: { type: "string", enum: ["HOOK", "STORY", "PAYOFF", "CTA"] },
          source_filename: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
          purpose: { type: "string" },
          visual_action: { type: "string" },
          editorial_score: { type: "number" },
          selection_reason: { type: "string" },
          speech_segment_ids: { type: "array", items: { type: "string" } },
          visual_treatment: { type: "string" },
          crop: {
            type: "string",
            enum: ["NONE", "CENTER", "FACE", "PRODUCT", "ACTION"],
          },
          zoom: { type: "number" },
          speed: { type: "number" },
          motion: { type: "string" },
          transition_in: {
            type: "string",
            enum: ["CUT", "DISSOLVE", "WHIP", "MATCH", "ZOOM", "PUNCH", "SLIDE_LEFT", "SLIDE_RIGHT", "SLIDE_UP", "SLIDE_DOWN", "FLASH", "NONE"],
          },
          transition_out: {
            type: "string",
            enum: ["CUT", "DISSOLVE", "WHIP", "MATCH", "ZOOM", "PUNCH", "SLIDE_LEFT", "SLIDE_RIGHT", "SLIDE_UP", "SLIDE_DOWN", "FLASH", "NONE"],
          },
          on_screen_text: { type: "string" },
          caption_mode: {
            type: "string",
            enum: ["NONE", "WORD_BY_WORD", "PHRASE"],
          },
          caption_emphasis: { type: "array", items: { type: "string" } },
          music_intensity: { type: "number" },
          voice_priority: { type: "number" },
          text_style: { type: "string" },
          text_animation: { type: "string" },
          text_position: { type: "string" },
          sfx: { type: "array", items: { type: "string" } },
        },
        required: [
          "id",
          "role",
          "source_filename",
          "start",
          "end",
          "purpose",
          "visual_action",
          "editorial_score",
          "selection_reason",
          "speech_segment_ids",
          "visual_treatment",
          "crop",
          "zoom",
          "speed",
          "motion",
          "transition_in",
          "transition_out",
          "on_screen_text",
          "caption_mode",
          "caption_emphasis",
          "music_intensity",
          "voice_priority",
          "text_style",
          "text_animation",
          "text_position",
          "sfx",
        ],
      },
    },
  },
  required: [
    "title",
    "objective",
    "audience_takeaway",
    "core_message",
    "editorial_strategy",
    "brief_alignment",
    "target_duration_seconds",
    "script",
    "global_audio",
    "global_captions",
    "remake",
    "shots",
  ],
} as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}


function fitShotsToTargetDuration(shots: MasterShot[], targetSeconds: number): MasterShot[] {
  const target = clamp(Number(targetSeconds) || 15, 8, 30);
  const next = shots.map((shot) => ({ ...shot }));

  const total = () => next.reduce((sum, shot) => sum + Math.max(0, shot.end - shot.start), 0);
  let excess = total() - target;

  if (excess <= 0.05) return next;

  // Shorten long beats first. Preserve enough time for the hook and CTA to read.
  const minimumFor = (shot: MasterShot) =>
    shot.role === "CTA" ? 1.8 : shot.role === "HOOK" ? 0.65 : 0.62;

  const candidates = [...next].sort(
    (a, b) => (b.end - b.start) - (a.end - a.start)
  );

  for (const shot of candidates) {
    if (excess <= 0.05) break;

    const current = shot.end - shot.start;
    const minimum = minimumFor(shot);
    const reducible = Math.max(0, current - minimum);
    if (reducible <= 0) continue;

    const cut = Math.min(excess, reducible);
    shot.end = Number((shot.end - cut).toFixed(3));
    excess -= cut;
  }

  // If an unusually long AI plan still exceeds the target, remove the weakest
  // non-HOOK/non-CTA beats, but preserve a commercial skeleton.
  const minimumShotCount = target >= 12 ? 6 : 5;
  while (excess > 0.05 && next.length > minimumShotCount) {
    const removable = next
      .filter((shot) => shot.role !== "HOOK" && shot.role !== "CTA")
      .sort((a, b) => (a.editorial_score || 0) - (b.editorial_score || 0));

    const weakest = removable[0];
    if (!weakest) break;

    const index = next.indexOf(weakest);
    next.splice(index, 1);
    excess = total() - target;
  }

  return next;
}

function normalizeShot(
  shot: any,
  source: ClipAnalysis,
  index: number,
  segmentsById: Map<string, CaptionSegment>
): MasterShot {
  const duration = Math.max(0.5, Number(source.duration) || 0.5);
  let start = Number(shot.start);
  let end = Number(shot.end);

  if (!Number.isFinite(start)) start = Number(source.suggested_start) || 0;
  if (!Number.isFinite(end)) end = Number(source.suggested_end) || Math.min(duration, start + 3);

  start = clamp(start, 0, Math.max(0, duration - 0.25));
  end = clamp(end, start + 0.5, duration);

  const maxDuration = shot.role === "HOOK" || shot.role === "CTA" ? 3.6 : 5.5;
  if (end - start > maxDuration) end = Math.min(duration, start + maxDuration);

  const speechIds: string[] = Array.isArray(shot.speech_segment_ids)
    ? (shot.speech_segment_ids as any[]).map((id: any) => String(id)).filter((id: string) => segmentsById.has(id))
    : [];

  const speechText = speechIds
    .map((id) => segmentsById.get(id)?.text || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    id: typeof shot.id === "string" && shot.id.trim() ? shot.id.trim() : `shot-${index + 1}`,
    role: shot.role === "HOOK" || shot.role === "PAYOFF" || shot.role === "CTA" ? shot.role : "STORY",
    source_filename: source.filename,
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
    purpose: String(shot.purpose || "").trim(),
    visual_action: String(shot.visual_action || "").trim(),
    editorial_score: Number(clamp(Number(shot.editorial_score) || 0, 0, 100)),
    selection_reason: String(shot.selection_reason || "").trim(),
    speech_segment_ids: speechIds,
    speech_text: speechText,
    visual_treatment: String(shot.visual_treatment || "").trim(),
    crop: ["FACE", "PRODUCT", "ACTION", "CENTER"].includes(shot.crop) ? shot.crop : "NONE",
    zoom: Number(clamp(Number(shot.zoom) || 1, 1, 1.18).toFixed(3)),
    speed: Number(clamp(Number(shot.speed) || 1, 0.94, 1.06).toFixed(3)),
    motion: String(shot.motion || "subtle push-in").trim(),
    transition_in: ["DISSOLVE", "WHIP", "MATCH", "ZOOM", "PUNCH", "SLIDE_LEFT", "SLIDE_RIGHT", "SLIDE_UP", "SLIDE_DOWN", "FLASH", "NONE"].includes(shot.transition_in) ? shot.transition_in : "CUT",
    transition_out: ["DISSOLVE", "WHIP", "MATCH", "ZOOM", "PUNCH", "SLIDE_LEFT", "SLIDE_RIGHT", "SLIDE_UP", "SLIDE_DOWN", "FLASH", "NONE"].includes(shot.transition_out) ? shot.transition_out : "CUT",
    on_screen_text: String(shot.on_screen_text || "").trim(),
    caption_mode: ["WORD_BY_WORD", "PHRASE"].includes(shot.caption_mode) ? shot.caption_mode : "NONE",
    caption_emphasis: Array.isArray(shot.caption_emphasis)
      ? shot.caption_emphasis.map((x: any) => String(x).trim()).filter(Boolean)
      : [],
    music_intensity: clamp(Number(shot.music_intensity) || 0, 0, 1),
    voice_priority: clamp(Number(shot.voice_priority) || 1, 0, 1),
    text_style: String(shot.text_style || (shot.role === "HOOK" ? "HOOK_BOLD" : shot.role === "CTA" ? "CTA_BOLD" : "CLEAN")).trim(),
    text_animation: String(shot.text_animation || (shot.role === "HOOK" ? "WORD_POP" : shot.role === "CTA" ? "SLIDE_UP" : "WORD_POP")).trim(),
    text_position: String(shot.text_position || (shot.role === "CTA" ? "CENTER" : "LOWER")).trim(),
    sfx: Array.isArray(shot.sfx) ? shot.sfx.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 3) : [],
  };
}

function buildLegacyClips(shots: MasterShot[], analysis: ClipAnalysis[]) {
  const byFilename = new Map(analysis.map((clip) => [clip.filename, clip]));
  return shots.map((shot, index) => {
    const source = byFilename.get(shot.source_filename);
    return {
      order: index + 1,
      clip: source?.clip ?? index + 1,
      filename: shot.source_filename,
      role: shot.role === "PAYOFF" ? "STORY" : shot.role,
      start: shot.start,
      end: shot.end,
      duration: Number((shot.end - shot.start).toFixed(3)),
      score: Number(source?.score) || 0,
    };
  });
}


async function fitVoiceScriptToTimeline(script: string, durationSeconds: number) {
  const clean = String(script || "").replace(/\s+/g, " ").trim();
  if (!clean) return clean;

  const targetWords = Math.max(18, Math.min(42, Math.floor(durationSeconds * 2.45)));
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= targetWords) return clean;

  if (!openai) {
    return words.slice(0, targetWords).join(" ").replace(/[,:;.!?]+$/, ".");
  }

  const response = await openai.responses.create({
    model: "gpt-5.4-mini",
    store: false,
    input: [
      {
        role: "system",
        content:
          "You are an expert short-form commercial copy editor. Rewrite the supplied voiceover so it fits the exact visual duration. Preserve every important factual claim, offer, price, product name and CTA. Remove filler and repetition first. Write natural spoken language. Return only the final script.",
      },
      {
        role: "user",
        content: `VISUAL DURATION: ${durationSeconds.toFixed(2)} seconds\nMAX WORDS: ${targetWords}\nSCRIPT:\n${clean}`,
      },
    ],
  });

  const fitted = String(response.output_text || "").replace(/\s+/g, " ").trim();
  if (!fitted) return clean;
  return fitted.split(/\s+/).length <= targetWords
    ? fitted
    : fitted.split(/\s+/).slice(0, targetWords).join(" ").replace(/[,:;.!?]+$/, ".");
}

export async function POST(request: Request) {
  try {
    if (!openai || !apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is missing." }, { status: 500 });
    }

    const body = await request.json();
    const creativeBrief = body?.creative_brief && typeof body.creative_brief === "object" ? body.creative_brief : null;
    const businessProfile = body?.business_profile && typeof body.business_profile === "object" ? body.business_profile : {};
    const productionPlan = body?.production_plan && typeof body.production_plan === "object" ? body.production_plan : null;
    const analysis: ClipAnalysis[] = Array.isArray(body?.clips) ? body.clips : [];
    const captions: CaptionSegment[] = Array.isArray(body?.captions)
      ? body.captions
          .filter((c: any) => c && typeof c.filename === "string" && typeof c.text === "string")
          .map((c: any, index: number) => ({
            id: String(c.id || `speech-${index + 1}`),
            filename: c.filename,
            start: Number(c.start) || 0,
            end: Number(c.end) || 0,
            text: String(c.text).trim(),
            words: Array.isArray(c.words)
              ? c.words
                  .map((w: any) => ({ word: String(w.word || "").trim(), start: Number(w.start), end: Number(w.end) }))
                  .filter((w: CaptionWord) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
              : [],
          }))
          .filter((c: CaptionSegment) => c.text && c.end > c.start)
      : [];

    if (!analysis.length) {
      return NextResponse.json({ error: "No footage intelligence was provided." }, { status: 400 });
    }

    const candidates = analysis
      .map((clip) => ({ ...clip, duration: Number(clip.duration) || 0, score: Number(clip.score) || 0, verdict: String(clip.verdict || "") }))
      .filter((clip) => clip.filename && clip.verdict.toLowerCase() !== "reject");

    if (!candidates.length) {
      return NextResponse.json({ error: "ATLAS could not find any usable footage." }, { status: 422 });
    }

    const segmentsById = new Map(captions.map((segment) => [segment.id, segment]));

    const sourceData = candidates.map((clip) => ({
      filename: clip.filename,
      duration: clip.duration,
      score: clip.score,
      verdict: clip.verdict,
      shot_type: clip.shot_type,
      reason: clip.reason,
      strengths: clip.strengths || [],
      problems: clip.problems || [],
      recommended_use: clip.recommended_use || "",
      suggested_start: clip.suggested_start ?? 0,
      suggested_end: clip.suggested_end ?? Math.min(clip.duration || 3, 3),
    }));

    const speechData = captions.map((segment) => ({
      id: segment.id,
      filename: segment.filename,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      words: segment.words || [],
    }));

    const systemPrompt = `
You are ATLAS MASTER DIRECTOR — a senior short-form creative director,
scriptwriter and editor.

THIS IS THE REAL FOOTAGE REMAKE STAGE.

The user already created an IDEAL BLUEPRINT before uploading footage.
That blueprint describes the best Reel ATLAS wanted to make if ideal shots
were available.

Now you have:
1. the original creative brief,
2. the IDEAL BLUEPRINT,
3. real footage intelligence,
4. footage-to-shot matching results,
5. available transcript/caption segments.

Your job is NOT to blindly execute the ideal blueprint.

Your job is to compare IDEAL vs REAL and create the BEST POSSIBLE REMAKE
using ONLY footage that actually exists.

CORE PRINCIPLE:
The creative objective survives.
The execution can change.

CREATIVE CONTROL FIELDS — THESE ARE EXPLICIT DIRECTORIAL CHOICES:
The structured creative brief may contain:
- editing_style: the desired editing language. Treat it as a hard style direction.
  Examples: Cinematic Commercial, Fast Viral, Luxury / Premium, UGC / Authentic, Product Launch.
- hook_priority: what should win the first 1–1.5 seconds.
  Examples: Visual Shock, Product Beauty, Price / Offer, Human Reaction, Curiosity.

Do not treat these as decorative metadata.
Use them to choose the opening shot, shot rhythm, transitions, motion, text treatment,
SFX density, visual treatment and overall editorial behavior.
If editing_style is Cinematic Commercial, prioritize polished commercial pacing, motivated
motion, restrained but premium typography and purposeful transitions.
If editing_style is Fast Viral, prioritize immediate novelty, faster cuts and stronger text/SFX hits.
If editing_style is Luxury / Premium, prioritize clean composition, controlled motion and minimal typography.
If editing_style is UGC / Authentic, prioritize human moments, natural motion and less-polished treatment.
If editing_style is Product Launch, prioritize product reveal, feature/value communication and a strong final hero.

For hook_priority, choose the strongest available real footage that satisfies that priority.
Do not force a weak hook simply because it has the correct role label.

THINK IN THIS ORDER:

1. LOCK THE CREATIVE OBJECTIVE
Preserve objective, audience, desired action, core message, tone, pacing and
target duration unless the real footage makes a small adaptation necessary.

2. AUDIT THE IDEAL BLUEPRINT
Understand its hook, story, payoff, CTA, voice, music, SFX, captions,
text and ideal shot requirements.

3. AUDIT THE REAL FOOTAGE
Understand what every usable clip actually contains, its quality, duration,
framing, motion, usable moments, strengths and problems.

4. COMPARE IDEAL VS REAL
For important ideal beats decide:
- KEEP: the footage can execute the intended beat.
- ADAPT: the footage can execute it, but wording/order/treatment must change.
- REBUILD: the original beat is not realistically executable with the footage.

5. REMAKE THE CREATIVE PLAN
Do not merely report missing shots. Actually redesign the Reel around the
strongest available footage.

IMPORTANT: IDEAL SHOT LABELS ARE NOT TIMELINE ORDERS.
A label such as hook, setup, development, payoff or CTA describes the ROLE
that a visual can play. It does NOT mean that the clip must appear at a
fixed position in the final Reel.

The real footage is allowed to change the order. Judge every candidate by
actual editorial strength: attention, clarity, emotion, product desire,
motion, novelty, information value and fit with the current voice beat.
Then place it where it creates the strongest sequence.

Example: a bite/reaction shot may be labelled PAYOFF in the ideal blueprint,
but if it is the strongest attention-grabbing moment in the real footage,
it may be the HOOK. A clean product hero may be better near the ending.
Do NOT place a shot at the end merely because its ideal label says payoff.
Only the actual brand/offer/CTA ending should normally be reserved for the
last beat.

EDITORIAL PASS — THINK LIKE THE FINAL CUT EDITOR:
Before returning shots, mentally perform a first-pass cut and a second-pass refinement.

FIRST PASS:
- Rank EVERY usable candidate by editorial strength BEFORE assigning timeline positions.
- Do not confuse the Vision "shot_type" label with the final position. It is descriptive metadata only.
- Compare the strongest candidates directly. A higher-scoring candidate should normally be used over a lower-scoring one unless you can state a concrete editorial reason not to use it.
- If the top-scoring candidate is excluded, explicitly explain why in the plan.
- For a 10–16 second Reel with at least 4 strong usable sources, build 7 purposeful visual beats by default, with 6–9 allowed when the footage genuinely demands it. A 15-second commercial should normally have 7–8 visual beats so the edit has enough novelty without becoming frantic.
- For a 15-second target, keep the finished visual edit in a deliberate 13–15 second band. Do not collapse a complete 15-second commercial into a 6–8 second montage unless the brief explicitly asks for a sub-10-second cut.
- Keep most individual beats around 0.85–2.2 seconds. The first hook should normally be 0.55–1.05 seconds unless a slower visual shock clearly earns more time. The CTA may be 1.8–2.8 seconds.
- Prefer a rhythm of HOOK ACTION → DETAIL → ACTION → CONTRAST/RESULT → HUMAN/PAYOFF → HERO → CTA when the footage supports it. Do not let two adjacent beats communicate the same visual idea.
- Prefer different visual information per beat. Different timestamps from the same source count only when the visual moment is genuinely different.
- Choose the strongest attention-grabbing visual for the first 0.55–1.0 seconds, regardless of its ideal blueprint label, and make the first text/SFX beat land immediately with it when useful.
- Match each visual beat to the exact idea being spoken or communicated.
- Remove redundant clips.
- Keep most cuts between 0.75 and 2.2 seconds. The first 2 seconds should normally contain at least two distinct visual moments when the footage supports it. Use longer holds only for a payoff, price reveal or CTA that genuinely needs reading time.
- Do not use the same visual idea twice consecutively.

SECOND PASS:
- Re-score the proposed sequence as a viewer, not as a checklist.
- If moving a shot earlier creates a stronger hook, MOVE IT.
- If a supposed payoff is better as a hook or mid-story interruption, MOVE IT.
- If the supposed hook is visually weak, demote it.
- Only keep the original blueprint order when the real footage proves that it is the strongest order.
- The sequence should feel like an editor discovered the best story in the footage, not like the blueprint was filled slot-by-slot.

THIRD PASS — RETENTION CHECK:
- Check pacing every 1–2 seconds.
- Check that the viewer sees something new when the story advances.
- Use alternate moments from the same source when they are genuinely different.
- Make the emotional/product high point land at the strongest moment of the story, not automatically at the end.
- Reserve the clearest brand/offer/CTA visual for the ending when available.
- If a shot is visually weak, shorten it rather than padding it.
- If the footage cannot support a beat, change the beat rather than forcing it.
- Reject any sequence that feels like “blueprint slot 1 → slot 2 → slot 3” when a better footage-driven order exists.

6. VOICE DECISION
If the ideal Reel needs speech/voiceover, decide whether it should be:
- USER_RECORDING, or
- AI_VOICE.
If voice is needed, provide the COMPLETE word-for-word final script.
Never write "mention the offer" or "talk about the burger".
Write the exact words to say.
If voice is not needed, use NONE and an empty script.

7. BUILD THE FINAL EDIT PLAN
The returned shots must reference real filenames and valid timestamps.

HARD RULES:
- NEVER invent footage, filenames or timestamps.
- NEVER use rejected footage.
- NEVER invent facts, prices, offers or dialogue unsupported by the brief or
  supplied material.
- If an ideal shot is missing, adapt or rebuild around real footage.
- Prefer a strong honest Reel over a fictional perfect one.
- Do not force every uploaded clip into the edit.
- A source filename may be reused deliberately when DIFFERENT timestamps or crops create a new editorial beat.
- Never repeat the exact same source timestamp window.
- The ideal blueprint’s shot order is advisory only; the final shots array must be ordered by the best real edit.
- The final shot should normally be the strongest available CTA/brand/offer ending, but only when such footage exists.
- Timestamps must stay inside source duration.
- Zoom must stay between 1.0 and 1.18.
- Use a concrete motion value such as "push-in", "pull-out", "pan-left", "pan-right", or "static" and keep speed between 0.94 and 1.06.
- For every beat choose a deliberate text treatment when text is useful: text_style examples are "HOOK_BOLD", "PRICE_ACCENT", "WORD_EMPHASIS", "MINIMAL", "CTA_BOLD", "CLEAN"; text_animation examples are "POP", "WORD_POP", "SLIDE_UP", "SLIDE_LEFT", "SLIDE_RIGHT", "FADE_UP", "NONE"; text_position examples are "TOP", "CENTER", "LOWER", "SAFE_TOP", "SAFE_LOWER".
- Do not add on-screen text to every beat by default. Use text when it clarifies the hook, value, offer, feature or CTA.
- SFX should be intentional and sparse. Use physical/editorial labels when the footage supports them: "WATER_SPRAY", "FOAM", "WIPE_TEXTURE", "MACHINE_HUM", "WHOOSH", "REVEAL_IMPACT", "CTA_HIT", "HOOK_IMPACT", "SOFT_IMPACT", "CLICK", "CRUNCH", "SIZZLE", "RISER"; normally 0–2 per beat. Prefer real-world physical cues for actions (water, wipe, machine, polish) and reserve impacts/whooshes for transitions, reveals and text emphasis.
- Motion, typography and SFX must vary with the editing style. Never apply the same animation, motion and SFX pattern to every shot. For HOOK text prefer KINETIC/WORD_POP/POP when the phrase is short; use a stronger 0.02–0.22s entrance. For CTA use a clear final lock-up rather than a generic caption.
- Prefer motivated transitions: action-to-action cuts, match cuts for matching movement/shape, whip only for genuine energy shifts, dissolve only for time/emotional changes.
- Prefer cuts that land on a visual action or spoken emphasis. Treat the first 1.5 seconds as the highest-priority retention zone.
- Prefer CUT; other transitions need a reason. Use MATCH only when an action or shape clearly carries across the cut. Use WHIP sparingly.
- Avoid two consecutive shots with the same composition, motion direction, and visual treatment.
- speech_segment_ids may reference ONLY supplied transcript IDs.
- If there is no usable speech, do not invent speech from footage.
- Captions based on speech must use supplied transcript segments.

SCRIPT RULES:
The final script must match the REMADE edit, not blindly repeat the ideal
script. Rewrite it whenever the available footage changes the story.

A voice script must sound natural aloud and fit the target duration.
If the target is around 15 seconds, keep the AI voice roughly 28–36 spoken words.
Never create a 20+ second script for a 12–15 second visual concept just because more narration is possible.
The visual timeline is the primary editorial clock.

AUDIO RULES:
Voice wins over music. Music supports the story. SFX must have a purpose.

TEXT RULES:
On-screen text must be concise and factually supported.

PRO EDIT V19 — ACTUAL CRAFT, NOT JUST METADATA:
- The renderer is deterministic. Therefore the shot fields are the edit: choose them deliberately.
- For a 15s commercial with 6+ usable sources, target 7–8 beats unless the footage genuinely rewards fewer.
- Do not put on-screen text on every beat. Usually reserve designed typography for HOOK, one value/feature beat, and CTA.
- Use at least 2 distinct text animation systems across a text-bearing sequence when useful.
- Use at least 3 distinct motion treatments across the sequence when footage supports it.
- Prefer 5–7 CUTs and at most 1–2 motivated non-CUT transitions in a 15s commercial.
- Non-CUT transitions must be attached to a visual reason: motion continuation, shape match, reveal, or energy spike.
- Never use a fancy transition just because it is available.
- Hook typography should feel like a designed headline; CTA should feel like a lock-up; process captions should be minimal.
- If the footage contains a clear transformation/result, protect the result as the visual climax and do not bury it under effects.
- Every shot must have a distinct editorial job. If two adjacent shots have the same job, remove/reorder one.

PRO EDITORIAL CHOREOGRAPHY — NON-NEGOTIABLE:
- Treat each cut as a designed handoff, not a file change.
- Every non-CUT transition needs a reason: motion continuation, shape match, energy spike, time change, or reveal.
- CUT remains dominant. Do not spam fancy transitions.
- Do not use the same transition type more than twice consecutively.
- Motion must create contrast between beats: restrained/static for beauty, PUSH_IN for detail, PAN for movement, HANDHELD for human/action, and restraint for the hero.
- Typography is a graphic system, not a label system. Use text only when it improves communication.
- Hook and CTA may use stronger hierarchy; process beats should often have no text.
- When text is used, use hierarchy, safe margins, deliberate entrance/exit and optional accent emphasis rather than repeating one preset.
- Use WORD_POP/WORD_REVEAL for short phrases, SLIDE_UP/SLIDE_LEFT for editorial labels, and FADE for restrained premium beats.
- The CTA is a designed lock-up: strongest hero source, concise action, enough reading time and visual breathing room.
- The first 1.5s should contain a deliberate visual hook plus a designed text/SFX hit when useful.
- If two adjacent shots feel like "clip → clip", redesign the handoff using action, composition, rhythm or a motivated transition.

ANTI-TEMPLATE VALIDATION:
Before returning JSON, perform this private checklist:
1. Identify the best 3 real candidates by Vision score and visual usefulness.
2. Confirm each is either used in the final timeline OR consciously rejected with a reason.
3. Confirm the first shot is the strongest attention candidate, not simply the first blueprint role.
4. Confirm the final shot is the strongest available ending candidate, not automatically the PAYOFF.
5. Confirm no two consecutive shots communicate the same visual idea.
6. Confirm the timeline has purposeful visual changes across the full duration.
7. Confirm no two consecutive shots use the same source unless the visual action is materially different.
8. Confirm the same exact timestamp window is never repeated.
9. Confirm at least 4 unique source files are used for a 15-second Reel when available.
10. Confirm the finished visual duration stays inside the deliberate target band.
11. Confirm at least 5 shots survive for a 15-second commercial unless the footage is genuinely insufficient.
12. Confirm the edit still works if the ideal blueprint labels are mentally removed.

QUALITY BAR:
The final Reel should feel intentionally designed around what was actually
captured, not like footage was forced into a prewritten template.

Return ONLY the structured JSON object required by the application.
`;

    const userPrompt = `
=== BUSINESS PROFILE ===
${JSON.stringify(businessProfile, null, 2)}

=== CREATIVE BRIEF ===
${JSON.stringify(creativeBrief || {}, null, 2)}

=== IDEAL BLUEPRINT ===
Created BEFORE seeing the real footage.
${JSON.stringify(productionPlan || {}, null, 2)}

=== REAL FOOTAGE INTELLIGENCE ===
${JSON.stringify(sourceData, null, 2)}

=== FOOTAGE-TO-SHOOT MATCHING ===
${JSON.stringify(body?.footage_matches || [], null, 2)}

=== AVAILABLE SPEECH / TRANSCRIPT ===
${JSON.stringify(speechData, null, 2)}

NOW PERFORM THE REMAKE.

First decide whether the Ideal Blueprint should be KEEP, ADAPT or REBUILD.

Then perform a footage-first editorial ranking. Do NOT start by assigning
clip 1 to ideal shot 1, clip 2 to ideal shot 2, etc. First identify the
strongest real moments, then build the story around them.

For every selected shot, provide an editorial_score (0–100) and a concrete
selection_reason. Treat the Vision score as evidence, not as the final
decision. The final timeline must reflect your own comparison of hook
strength, novelty, emotion, product desire, clarity, motion, and sequence
fit.

For a 10–16 second Reel with at least 3 strong usable sources, target 5–8
visual beats. Do not inflate the count with meaningless cuts; every beat
must add new visual information.

Then create the final Master Edit Plan. The shots array MUST be in the
actual playback order of the final Reel. The shot_type field describes the
editorial role of that shot, not a mandatory position.

Before finalizing, ask: “If I ignored the blueprint labels and watched only
the footage, would I still choose roughly this order?” If not, reorder it.

The REMAKE object must explicitly explain:
- what survives from the Ideal Blueprint,
- what changed,
- which ideal shots are missing,
- what the footage is actually good at,
- what problems the footage has,
- whether voice is needed,
- whether the user or AI should provide the voice,
- the exact final voice script if needed,
- the revised timeline.

The "shots" array is the actual executable final edit.
Every shot MUST use a real source filename and valid source timestamps.

Do NOT optimize for using all footage.
Optimize for the strongest finished Reel while preserving the original brief.
Build a deliberate beginning, middle and ending.
Create enough visual changes to sustain attention across the full target duration.
For a 15-second target, do NOT return a 6–9 second edit unless the footage is genuinely unusable; prefer 13–15 seconds with 5–7 meaningful shots.
Do not fill unused time by holding or repeating a weak shot.
Avoid repeating the same visual action in adjacent beats.
Use different motion ideas across the sequence (for example static -> push-in -> pan -> action -> hero hold) instead of assigning the same generic motion to every shot.
Use transitions intentionally. CUT is the default, but use a MATCH, DISSOLVE or WHIP only where it improves continuity or emphasis; never use transitions decoratively.
If footage is insufficient for the ideal story, REBUILD the story around the strongest real moments.

SOURCE DIVERSITY RULE:
- If 4+ usable source files exist, use at least 4 unique source filenames in a 15-second Reel.
- Avoid the same filename in adjacent shots.
- Avoid reusing the same source for both HOOK and CTA unless it contains genuinely different moments and no better ending exists.
- Prefer a visually different source for the payoff than the hook.

VOICE PACING RULE:
- The final visual timeline is the hard clock for narration.
- For a 10–16 second Reel, normally write about 2.1–2.45 spoken words per second.
- Never write a 19–20 second voiceover for a 12–15 second Reel.
- Preserve the strongest factual claim, offer/price and CTA; remove filler first.
- The voice should finish naturally at or slightly before the final visual beat.
`;


    const response = await openai.responses.create({
      model: "gpt-5.4-mini",
      store: false,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "atlas_master_edit_plan_v2",
          strict: true,
          schema: masterPlanSchema,
        },
      },
    });

    if (!response.output_text) throw new Error("ATLAS Master Director returned no plan.");
    const raw = JSON.parse(response.output_text);
    const byFilename = new Map(candidates.map((clip) => [clip.filename, clip]));
    const seenWindows = new Set<string>();
    const shots: MasterShot[] = [];

    for (const rawShot of Array.isArray(raw.shots) ? raw.shots : []) {
      const filename = String(rawShot?.source_filename || "");
      const source = byFilename.get(filename);
      if (!source) continue;

      const normalized = normalizeShot(
        rawShot,
        source,
        shots.length,
        segmentsById
      );

      const signature = [
        normalized.source_filename,
        normalized.start.toFixed(2),
        normalized.end.toFixed(2),
      ].join("|");

      if (seenWindows.has(signature)) continue;
      seenWindows.add(signature);
      shots.push(normalized);
    }

    if (!shots.length) throw new Error("ATLAS could not map the Master Plan back to real footage.");

    const requestedTarget = Number(raw.target_duration_seconds) || Number(creativeBrief?.target_duration_seconds) || 15;
    const fittedShots = fitShotsToTargetDuration(shots, requestedTarget);
    const totalDuration = Number(fittedShots.reduce((sum, shot) => sum + shot.end - shot.start, 0).toFixed(2));

    // VOICE SYNC: the finished visual edit is the clock. If the Director wrote
    // a script that is too long for the actual cut, rewrite it before the UI
    // generates audio. This prevents long narration from being truncated by
    // the renderer.
    if (raw.remake?.voice?.needed && raw.remake?.voice?.script) {
      const originalScript = String(raw.remake.voice.script).trim();
      const fittedScript = await fitVoiceScriptToTimeline(originalScript, totalDuration);
      raw.remake.voice.script = fittedScript;
      raw.remake.voice.reason = [
        String(raw.remake.voice.reason || "").trim(),
        `Voice fitted to ${totalDuration.toFixed(2)}s visual timeline (${fittedScript.split(/\s+/).filter(Boolean).length} words).`,
      ].filter(Boolean).join(" ");
    }

    const emphasis = Array.isArray(raw.global_captions?.emphasis_words)
      ? raw.global_captions.emphasis_words.map((x: any) => String(x).trim()).filter(Boolean)
      : [];

    const masterPlan = {
      version: "2.0",
      success: true,
      title: String(raw.title || "ATLAS Reel"),
      objective: String(raw.objective || ""),
      audience_takeaway: String(raw.audience_takeaway || ""),
      core_message: String(raw.core_message || ""),
      editorial_strategy: String(raw.editorial_strategy || ""),
      brief_alignment: String(raw.brief_alignment || ""),
      creative_brief: creativeBrief,
      target_duration_seconds: Math.min(Number(raw.target_duration_seconds) || requestedTarget, requestedTarget),
      total_duration_seconds: totalDuration,
      script: {
        hook: String(raw.script?.hook || ""),
        setup: String(raw.script?.setup || ""),
        development: String(raw.script?.development || ""),
        payoff: String(raw.script?.payoff || ""),
        ending: String(raw.script?.ending || ""),
      },
      remake: {
        decision: ["KEEP", "ADAPT", "REBUILD"].includes(raw.remake?.decision)
          ? raw.remake.decision
          : "ADAPT",
        summary: String(raw.remake?.summary || ""),
        what_survives_from_ideal: Array.isArray(raw.remake?.what_survives_from_ideal)
          ? raw.remake.what_survives_from_ideal.map((x: any) => String(x))
          : [],
        what_changed: Array.isArray(raw.remake?.what_changed)
          ? raw.remake.what_changed.map((x: any) => String(x))
          : [],
        missing_ideal_shots: Array.isArray(raw.remake?.missing_ideal_shots)
          ? raw.remake.missing_ideal_shots.map((x: any) => String(x))
          : [],
        footage_strengths: Array.isArray(raw.remake?.footage_strengths)
          ? raw.remake.footage_strengths.map((x: any) => String(x))
          : [],
        footage_problems: Array.isArray(raw.remake?.footage_problems)
          ? raw.remake.footage_problems.map((x: any) => String(x))
          : [],
        voice: {
          needed: Boolean(raw.remake?.voice?.needed),
          source: ["USER_RECORDING", "AI_VOICE", "NONE"].includes(raw.remake?.voice?.source)
            ? raw.remake.voice.source
            : "NONE",
          reason: String(raw.remake?.voice?.reason || ""),
          script: String(raw.remake?.voice?.script || ""),
        },
        revised_timeline: Array.isArray(raw.remake?.revised_timeline)
          ? raw.remake.revised_timeline.map((x: any) => ({
              beat_id: String(x?.beat_id || ""),
              start: Number(x?.start) || 0,
              end: Number(x?.end) || 0,
              purpose: String(x?.purpose || ""),
              source_filename: String(x?.source_filename || ""),
              reason_for_change: String(x?.reason_for_change || ""),
            }))
          : [],
      },
      audio: {
        music_mood: String(raw.global_audio?.music_mood || "Energetic"),
        music_intensity: clamp(Number(raw.global_audio?.music_intensity) || 0, 0, 1),
        voice_priority: clamp(Number(raw.global_audio?.voice_priority) || 1, 0, 1),
        duck_music_under_speech: raw.global_audio?.duck_music_under_speech !== false,
        target_lufs: Number(raw.global_audio?.target_lufs) || -14,
      },
      captions: {
        enabled: raw.global_captions?.enabled !== false,
        style: String(raw.global_captions?.style || "Bold"),
        max_words_per_chunk: Math.max(2, Math.min(6, Number(raw.global_captions?.max_words_per_chunk) || 4)),
        emphasis_words: emphasis,
        position: String(raw.global_captions?.position || "LOWER_CENTER"),
      },
      shots: fittedShots,
      clips: buildLegacyClips(fittedShots, candidates),
      speech_segments_used: fittedShots.flatMap((shot) => shot.speech_segment_ids),
    };

    return NextResponse.json(masterPlan);
  } catch (error: any) {
    console.error("ATLAS MASTER DIRECTOR ERROR:", error);
    return NextResponse.json({ error: error?.message || "ATLAS Master Director failed." }, { status: 500 });
  }
}
