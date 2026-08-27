import OpenAI from "openai";
import { NextResponse } from "next/server";

const apiKey = process.env.OPENAI_API_KEY;

const openai = apiKey
  ? new OpenAI({
      apiKey,
    })
  : null;

const productionPlanSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    duration_seconds: { type: "integer" },
    format: { type: "string" },
    goal: { type: "string" },
    style: { type: "string" },
    recommendation: { type: "string" },

    // Existing frontend-compatible structure
    script: {
      type: "object",
      additionalProperties: false,
      properties: {
        hook: { type: "string" },
        setup: { type: "string" },
        development: { type: "string" },
        payoff: { type: "string" },
        ending: { type: "string" },
        voiceover: { type: "string" },
      },
      required: [
        "hook",
        "setup",
        "development",
        "payoff",
        "ending",
        "voiceover",
      ],
    },

    audio: {
      type: "object",
      additionalProperties: false,
      properties: {
        music_mood: { type: "string" },
        natural_sound: { type: "string" },
        sound_effects: { type: "string" },
        voiceover: { type: "string" },
      },
      required: [
        "music_mood",
        "natural_sound",
        "sound_effects",
        "voiceover",
      ],
    },

    captions: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        style: { type: "string" },
        strategy: { type: "string" },
      },
      required: ["enabled", "style", "strategy"],
    },

    creative_brief: {
      type: "object",
      additionalProperties: false,
      properties: {
        raw_request: { type: "string" },
        platform: { type: "string" },
        objective: { type: "string" },
        audience: { type: "string" },
        desired_action: { type: "string" },
        core_message: { type: "string" },
        tone: { type: "string" },
        pacing: { type: "string" },
        target_duration_seconds: { type: "integer" },
        visual_style: { type: "string" },
      },
      required: [
        "raw_request",
        "platform",
        "objective",
        "audience",
        "desired_action",
        "core_message",
        "tone",
        "pacing",
        "target_duration_seconds",
        "visual_style",
      ],
    },

    // NEW: the ideal creative blueprint exists before real footage is seen.
    creative_strategy: {
      type: "object",
      additionalProperties: false,
      properties: {
        concept: { type: "string" },
        hook_strategy: { type: "string" },
        story_strategy: { type: "string" },
        payoff_strategy: { type: "string" },
        cta_strategy: { type: "string" },
        retention_strategy: { type: "string" },
        visual_style: { type: "string" },
      },
      required: [
        "concept",
        "hook_strategy",
        "story_strategy",
        "payoff_strategy",
        "cta_strategy",
        "retention_strategy",
        "visual_style",
      ],
    },

    voice: {
      type: "object",
      additionalProperties: false,
      properties: {
        needed: { type: "boolean" },
        reason: { type: "string" },
        source: {
          type: "string",
          enum: ["USER_RECORDING", "AI_VOICE", "NONE"],
        },
        language: { type: "string" },
        delivery: { type: "string" },
        script: { type: "string" },
        estimated_duration_seconds: { type: "number" },
      },
      required: [
        "needed",
        "reason",
        "source",
        "language",
        "delivery",
        "script",
        "estimated_duration_seconds",
      ],
    },

    music: {
      type: "object",
      additionalProperties: false,
      properties: {
        needed: { type: "boolean" },
        mood: { type: "string" },
        energy: { type: "string" },
        purpose: { type: "string" },
        duck_under_voice: { type: "boolean" },
      },
      required: [
        "needed",
        "mood",
        "energy",
        "purpose",
        "duck_under_voice",
      ],
    },

    sfx: {
      type: "object",
      additionalProperties: false,
      properties: {
        needed: { type: "boolean" },
        strategy: { type: "string" },
        moments: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { type: "string" },
              purpose: { type: "string" },
              beat_id: { type: "string" },
            },
            required: ["type", "purpose", "beat_id"],
          },
        },
      },
      required: ["needed", "strategy", "moments"],
    },

    captions_blueprint: {
      type: "object",
      additionalProperties: false,
      properties: {
        needed: { type: "boolean" },
        style: { type: "string" },
        placement: { type: "string" },
        emphasis_strategy: { type: "string" },
      },
      required: [
        "needed",
        "style",
        "placement",
        "emphasis_strategy",
      ],
    },

    text_overlays: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          beat_id: { type: "string" },
          text: { type: "string" },
          purpose: { type: "string" },
          priority: {
            type: "string",
            enum: ["PRIMARY", "SECONDARY"],
          },
        },
        required: ["beat_id", "text", "purpose", "priority"],
      },
    },

    timeline: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          beat_id: { type: "string" },
          start: { type: "number" },
          end: { type: "number" },
          purpose: { type: "string" },
          visual_goal: { type: "string" },
          ideal_shot: { type: "string" },
          voice_line: { type: "string" },
          on_screen_text: { type: "string" },
          sfx: { type: "string" },
          transition: {
            type: "string",
            enum: [
              "CUT",
              "MATCH_CUT",
              "SMASH_CUT",
              "DISSOLVE",
              "NONE",
            ],
          },
          pacing: { type: "string" },
        },
        required: [
          "beat_id",
          "start",
          "end",
          "purpose",
          "visual_goal",
          "ideal_shot",
          "voice_line",
          "on_screen_text",
          "sfx",
          "transition",
          "pacing",
        ],
      },
    },

    // These are the shots we ideally need. They are NOT yet matched to
    // uploaded files. That happens in the next stage.
    shot_requirements: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          shot_id: { type: "string" },
          beat_id: { type: "string" },
          importance: {
            type: "string",
            enum: ["MUST_HAVE", "PREFERRED", "OPTIONAL"],
          },
          description: { type: "string" },
          subject: { type: "string" },
          framing: { type: "string", minLength: 60 },
          camera_action: { type: "string" },
          usable_for: { type: "string" },
        },
        required: [
          "shot_id",
          "beat_id",
          "importance",
          "description",
          "subject",
          "framing",
          "camera_action",
          "usable_for",
        ],
      },
    },

    creative_lock: {
      type: "object",
      additionalProperties: false,
      properties: {
        scenario: { type: "string" },
        concept: { type: "string" },
        non_negotiable_mechanism: { type: "string" },
        audience_tension: { type: "string" },
        proof_requirement: { type: "string" },
      },
      required: [
        "scenario",
        "concept",
        "non_negotiable_mechanism",
        "audience_tension",
        "proof_requirement",
      ],
    },

    editorial_logic: {
      type: "object",
      additionalProperties: false,
      properties: {
        opening_reason: { type: "string" },
        escalation: { type: "string" },
        payoff_reason: { type: "string" },
        continuity_rule: { type: "string" },
        shot_economy_rule: { type: "string" },
      },
      required: [
        "opening_reason",
        "escalation",
        "payoff_reason",
        "continuity_rule",
        "shot_economy_rule",
      ],
    },

    script_qa: {
      type: "object",
      additionalProperties: false,
      properties: {
        passes_creative_lock: { type: "boolean" },
        passes_business_truth: { type: "boolean" },
        passes_shot_feasibility: { type: "boolean" },
        passes_cta_alignment: { type: "boolean" },
        summary: { type: "string" },
      },
      required: [
        "passes_creative_lock",
        "passes_business_truth",
        "passes_shot_feasibility",
        "passes_cta_alignment",
        "summary",
      ],
    },

    final_cta: {
      type: "object",
      additionalProperties: false,
      properties: {
        spoken: { type: "string" },
        on_screen: { type: "string" },
        visual: { type: "string" },
      },
      required: ["spoken", "on_screen", "visual"],
    },

    quality_requirements: {
      type: "array",
      items: { type: "string" },
    },

    // Existing UI expects this array.
    shots: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          number: { type: "string" },
          title: { type: "string" },
          duration: { type: "string" },
          description: { type: "string" },
          instruction: { type: "string", minLength: 500 },
          camera_movement: { type: "string", minLength: 60 },
          framing: { type: "string" },
          role: { type: "string" },
          why: { type: "string", minLength: 60 },
          audio: { type: "string" },
          on_screen_text: { type: "string" },
        },
        required: [
          "number",
          "title",
          "duration",
          "description",
          "instruction",
          "camera_movement",
          "framing",
          "role",
          "why",
          "audio",
          "on_screen_text",
        ],
      },
    },
  },

  required: [
    "title",
    "duration_seconds",
    "format",
    "goal",
    "style",
    "recommendation",
    "script",
    "audio",
    "captions",
    "creative_brief",
    "creative_strategy",
    "voice",
    "music",
    "sfx",
    "captions_blueprint",
    "text_overlays",
    "timeline",
    "shot_requirements",
    "creative_lock",
    "editorial_logic",
    "script_qa",
    "final_cta",
    "quality_requirements",
    "shots",
  ],
};

export async function POST(request: Request) {
  try {
    if (!apiKey || !openai) {
      return NextResponse.json(
        {
          error:
            "OPENAI_API_KEY is missing. Add it to .env.local and restart the server.",
        },
        { status: 500 }
      );
    }

    const body = await request.json();

    const brief = body?.brief;
    const suppliedBrief =
      body?.creative_brief && typeof body.creative_brief === "object"
        ? body.creative_brief
        : {};

    if (!brief || typeof brief !== "string") {
      return NextResponse.json(
        { error: "A content brief is required." },
        { status: 400 }
      );
    }

    const businessProfile =
      body?.business_profile && typeof body.business_profile === "object"
        ? body.business_profile
        : {};

    const business = {
      name: String(businessProfile.name || ""),
      category: String(businessProfile.category || ""),
      description: String(businessProfile.description || ""),
      location: String(businessProfile.location || ""),
      audience: String(businessProfile.audience || suppliedBrief.audience || ""),
      website: String(businessProfile.website || ""),
      instagram: String(businessProfile.instagram || ""),
      tiktok: String(businessProfile.tiktok || ""),
      services: String(businessProfile.services || ""),
      offers: String(businessProfile.offers || ""),
      usp: String(businessProfile.usp || ""),
      personality: String(businessProfile.personality || ""),
      primary_color: String(businessProfile.primary_color || ""),
      secondary_color: String(businessProfile.secondary_color || ""),
      font_family: String(businessProfile.font_family || ""),
      logo_url: String(businessProfile.logo_url || ""),
    };

    const systemPrompt = `
You are ATLAS SCENE — the IDEAL CREATIVE DIRECTOR.

Your job at this stage is NOT to edit footage.

You are working BEFORE the user uploads real footage.

You must first design the BEST POSSIBLE finished short-form Reel for the
business objective. This output becomes the IDEAL BLUEPRINT.

Later, another ATLAS stage will receive real user footage, compare it against
this blueprint, and REMAKE the blueprint around the footage that actually exists.

Therefore:
- Do NOT pretend that any real clip exists.
- Do NOT assign real filenames.
- Do NOT invent footage timestamps.
- Describe the ideal shots that would be needed.
- Make every creative decision concrete enough for a later AI system to compare
  against real footage.


SHOOTING INSTRUCTIONS — CRITICAL USER EXPERIENCE:
The person filming may know NOTHING about video production. The shot list must be executable directly from a phone screen.

Keep the requested number of SOURCE CLIPS low:
- Normally 4–6 source clips for a 12–20 second Reel.
- Use 7–8 only when genuinely necessary.
- Do not request multiple redundant angles just to have more footage.
The goal is minimum filming effort with maximum usable material.

IMPORTANT:
The "duration" field is the RAW RECORDING duration. Ask the user to record normally 5–8 seconds per source shot so ATLAS has handles and can extract multiple moments later. The final edit duration will be much shorter.

FOR EVERY SHOT, write ALL of these as concrete, beginner-friendly instructions:
1. WHAT TO FILM — exactly what object/person/action should be visible.
2. PHONE SETUP — vertical 9:16, rear camera when possible, approximate distance and height, and where the subject sits in frame.
3. START — what should already be ready before pressing record.
4. ACTION — exactly what the person should do during the recording, including direction and speed.
5. END — how/when to finish the take.
6. CAMERA MOVEMENT — exact movement, starting position, ending position, and speed; if static, explicitly say "keep the phone still".
7. FRAMING — what must be fully visible and what must not be cropped.
8. LIGHT — simple practical lighting advice appropriate to the situation.
9. AUDIO — whether to preserve natural sound; do not request spoken dialogue unless genuinely needed.
10. AVOID — the 2–4 most likely beginner mistakes.
11. WHY — explain the business/editorial purpose in plain language.
12. RECORDING LENGTH — tell them how many seconds of RAW footage to record.

The \`instruction\` field MUST visibly contain these exact labels, in this exact order:
WHAT TO FILM:
PHONE SETUP:
START:
ACTION:
END:
LIGHT:
AVOID:
RECORD:
Each label must be followed by concrete physical instructions. Do not compress the answer into a generic paragraph. A beginner must be able to execute the shot without asking what to do next.

Do NOT use vague filmmaking language by itself:
- "close-up"
- "cinematic"
- "slow push-in"
- "nice shot"
- "capture the product"
If you use one of these terms, immediately translate it into physical instructions a beginner can follow.

BAD:
"Close-up. Slow push-in."

GOOD:
"Hold the phone vertically about 30–40 cm from the product at product height. Press record while the product is already centered. Stay still for 1 second, then move the phone slowly 15–20 cm closer over about 3 seconds, keeping the full product visible. Stay still for 1 more second. Do not use digital zoom."

Each source clip should have a clear job in the final Reel: HOOK, PROOF, PROCESS, TEXTURE, HUMAN/ACTION, PAYOFF or CTA.

The checklist should feel like:
"Do this → now do this → now do this."
The user should not need to ask how to execute a shot.

Do not increase the amount of work for the user just to make the AI's job easier. The AI editor must do the hard work later.

You are responsible for deciding:

1. What the Reel is trying to achieve.
2. What the viewer should feel, understand and do.
3. The creative concept.
4. The selected scenario and its non-negotiable creative mechanism.
5. The hook.
6. The story.
7. The escalation.
8. The payoff.
9. The CTA.
10. Whether voiceover is actually useful.
11. If voiceover is useful, write the COMPLETE word-for-word spoken script.
12. Whether the user should record the voice or ATLAS should generate it.
13. Music direction.
14. SFX direction.
15. Caption strategy.
16. Exact on-screen text, including offers/prices when supplied.
17. The ideal second-by-second timeline.
18. The ideal shot requirements.
19. The quality requirements for the final Reel.

SCRIPT DIRECTOR — NON-NEGOTIABLE CREATIVE LOCK:

The upstream creative_strategy is already approved. You are NOT allowed to
replace it with a safer, more generic advertisement.

You must translate the approved concept into the script and shot plan.

The concept is the spine of the Reel:
CREATIVE STRATEGY → HOOK → STORY BEATS → PROOF → PAYOFF → CTA.

If a beat does not strengthen that spine, remove it.

NEVER default to:
"beautiful car → detailing process → close-up → reveal → book now"
unless that exact structure is demanded by the approved concept.

The selected scenario must visibly change the editorial logic.

Examples:
- TRANSFORMATION: establish the problem/state, create contrast, then earn the reveal.
- PROBLEM_SOLUTION: make the viewer recognize the problem before introducing the service.
- PROOF: show evidence or a visible demonstration rather than making unsupported claims.
- EDUCATIONAL: teach one useful idea clearly; do not turn it into a generic service ad.
- PREMIUM: sell the desired experience/feeling through composition, restraint and detail.
- TRUST: show precision, consistency, process or human care; avoid empty "quality" language.
- OFFER: make the offer/action immediately understandable and reserve the strongest
  conversion moment for the CTA.
- MAINTENANCE: communicate continuity and long-term care rather than another one-time reveal.

CREATIVE MECHANISM TEST:
The output must name one non-negotiable mechanism that makes this Reel this Reel.
That mechanism must influence at least 3 of:
- hook
- shot order
- visual contrast
- voiceover
- text
- pacing
- payoff
- CTA.

BUSINESS TRUTH TEST:
Use only facts in BUSINESS CONTEXT and STRUCTURED CREATIVE BRIEF.
Never invent prices, certifications, guarantees, unique techniques, customer counts,
results, locations beyond the supplied profile, or superiority claims.

SHOT ECONOMY:
Design the minimum number of source clips needed to execute the idea.
Every requested shot must have a distinct editorial job.
Do not ask for redundant angles.
Normally use 4–6 source clips for a 12–20 second Reel.

SHOT ORDER:
The shot list is not a list of pretty shots. It is a causal sequence.
Each shot must either:
- create curiosity,
- clarify the problem,
- provide proof,
- escalate the story,
- deliver the payoff,
- or make the CTA easier to act on.

CONTINUITY:
When an action or object continues across shots, describe the continuity requirement
so the later editor can cut them together naturally. Avoid impossible spatial changes.

HOOK:
The first 1–1.5 seconds must communicate a clear reason to keep watching.
Do not waste the opening on a logo, generic establishing shot or business name unless
the approved concept explicitly makes that the hook.

PAYOFF:
The payoff must resolve the exact tension introduced by the hook.
Do not use a generic beauty shot as a payoff if the concept promises a transformation,
proof, explanation or specific outcome.

CTA:
The CTA must match the supplied objective exactly.
Do not use "DM us", "Book now", "Visit us" or similar generic CTAs unless that action
is actually the requested objective.

SELF-QA BEFORE OUTPUT:
Before returning JSON, silently verify:
A. Can I explain the concept in one sentence without using the business name?
B. Does the script clearly execute the approved concept rather than replacing it?
C. Does every MUST_HAVE shot have a unique purpose?
D. Does the payoff resolve the hook?
E. Is every factual claim supported?
F. Does the CTA exactly match the objective?
G. Could the first 3 shots be rearranged without weakening the concept? If yes,
   the story is probably not structured strongly enough; improve it.
H. Is the requested footage realistically filmable by a beginner with a phone?

Set script_qa booleans to the truthful result of this checklist.

VOICEOVER RULE:
Do not write "mention the offer" or "talk about the product".
Write the actual words that should be spoken.

If voiceover is not useful, set needed=false, source=NONE and script="".

Do not invent business facts, prices, dates, offers, names or claims that were
not supplied by the user.

Treat the STRUCTURED CREATIVE BRIEF as the source of truth.
Preserve its objective, audience, desired action, tone, pacing and target duration.

CREATIVE CONTROL FIELDS:
The structured brief may also contain:
- editing_style: Cinematic Commercial, Fast Viral, Luxury / Premium, UGC / Authentic, or Product Launch.
- hook_priority: Visual Shock, Product Beauty, Price / Offer, Human Reaction, or Curiosity.

Use these two fields as explicit creative direction when designing the ideal blueprint.
Editing style should influence shot design, pacing, camera movement, typography, transitions,
SFX and overall finish. Hook priority should determine what the first 1–1.5 seconds must accomplish.
Do not invent facts to satisfy a hook priority; choose the strongest truthful visual concept available.

The target duration is a hard creative constraint. Build the timeline to cover
approximately the requested duration.

Every timeline beat must have:
- visual purpose
- ideal shot
- voice line
- on-screen text
- SFX decision
- transition decision
- pacing

Every shot requirement must say what should physically be filmed on a normal
smartphone.

IMPORTANT:
The result must be a complete creative plan, not just a script and not just a
shooting list.

The current frontend still uses the legacy script/audio/captions/shots fields,
so populate those too. They must agree with the new Ideal Blueprint fields.

Return ONLY the structured JSON object required by the application.

BUSINESS CONTEXT — SOURCE OF TRUTH:
${JSON.stringify(business, null, 2)}

Use the supplied business context to make the creative specific to this business.
Never replace it with a generic or invented business. Do not invent missing facts.

USER REQUEST:
${brief}

STRUCTURED CREATIVE BRIEF:
${JSON.stringify(suppliedBrief, null, 2)}

UPSTREAM CREATIVE STRATEGY:
If the structured brief contains an approved creative strategy, treat it as
LOCKED creative direction. Preserve its concept, hook strategy, story strategy,
payoff strategy, CTA strategy, retention strategy and visual style.

If no strategy is supplied, derive one from the brief — but do not invent facts.

The final JSON must include:
- creative_lock: the exact strategic spine being executed;
- editorial_logic: why the sequence works;
- script_qa: truthful self-check results.

The script, timeline and shots must all agree with creative_lock.
`;

    const response = await openai.responses.create({
      model: "gpt-5.4-mini",
      input: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: brief,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "atlas_scene_ideal_blueprint",
          strict: true,
          schema: productionPlanSchema,
        },
      },
    });

    console.log("ATLAS DIRECTOR ROUTE: SHOOT-COACH-ACTIVE-FINAL");
    const outputText = response.output_text;

    if (!outputText) {
      throw new Error("OpenAI returned an empty Ideal Blueprint.");
    }

    let productionPlan: any;

    try {
      productionPlan = JSON.parse(outputText);
    } catch {
      console.error("INVALID OPENAI OUTPUT:", outputText);
      throw new Error("OpenAI returned invalid production data.");
    }


    const requiredShootLabels = [
      "WHAT TO FILM:",
      "PHONE SETUP:",
      "START:",
      "ACTION:",
      "END:",
      "LIGHT:",
      "AVOID:",
      "RECORD:",
    ];

    // Repair the legacy `instruction` string from the structured shot fields.
    // This keeps the model focused on creative decisions while guaranteeing
    // that the beginner-facing checklist always has the exact sections the UI
    // expects. No second model call is needed.
    if (Array.isArray(productionPlan?.shots)) {
      productionPlan.shots = productionPlan.shots.map((shot: any) => {
        const existing =
          typeof shot?.instruction === "string"
            ? shot.instruction.trim()
            : "";

        const hasAllLabels = requiredShootLabels.every((label) =>
          existing.includes(label)
        );

        if (hasAllLabels && existing.length >= 500) {
          return shot;
        }

        const subject = String(
          shot?.description ||
            shot?.title ||
            "the main subject"
        ).trim();

        const framing = String(
          shot?.framing ||
            "Keep the full subject visible and leave a little space around it."
        ).trim();

        const movement = String(
          shot?.camera_movement ||
            "Keep the phone steady and make one slow, controlled movement."
        ).trim();

        const audio = String(
          shot?.audio ||
            "Keep natural sound only if it adds useful texture; otherwise record clean room sound."
        ).trim();

        const why = String(
          shot?.why ||
            "This shot must make the product immediately understandable and desirable."
        ).trim();

        const duration = String(
          shot?.duration || "5–8 seconds"
        ).trim();

        const screenText = String(
          shot?.on_screen_text || ""
        ).trim();

        const repairedInstruction = [
          `WHAT TO FILM: Film ${subject}. Make the important visual detail obvious immediately and keep the subject clean and unobstructed.`,
          `PHONE SETUP: Hold the phone vertically in 9:16. Use the rear camera when possible. ${framing} Keep the lens at approximately subject height unless the shot specifically needs a lower or higher angle.`,
          `START: Before pressing record, place the subject exactly where you want it in frame, clean the lens, lock exposure/focus if your phone allows it, and make sure nothing important is cropped.`,
          `ACTION: ${movement} Start the movement only after the shot is stable. Move smoothly and consistently rather than changing speed halfway through.`,
          `END: Finish the movement cleanly, hold the final composition for about 1 second, and stop recording without tapping or shaking the phone.`,
          `LIGHT: Use the brightest soft light available. Keep the main subject evenly visible, avoid harsh backlight, and do not let reflections or blown highlights hide the important detail.`,
          `AVOID: Do not use digital zoom. Do not shake the phone, reframe during the take, cover the lens, or let hands/objects block the main subject. ${screenText ? `Leave enough clean space for the on-screen text "${screenText}".` : "Leave clean space if ATLAS later needs to add text."}`,
          `RECORD: Record one continuous RAW take for ${duration}. Keep recording for the full requested duration so ATLAS has handles to cut from later.`,
          `AUDIO: ${audio}`,
          `WHY: ${why}`,
        ].join("\n\n");

        return {
          ...shot,
          instruction: repairedInstruction,
        };
      });
    }

    // Defensive normalization. This keeps the existing UI stable while the
    // new blueprint becomes the source of truth for later pipeline stages.
    productionPlan.creative_lock = {
      scenario: String(productionPlan.creative_lock?.scenario || productionPlan.creative_strategy?.concept || ""),
      concept: String(productionPlan.creative_lock?.concept || productionPlan.creative_strategy?.concept || ""),
      non_negotiable_mechanism: String(productionPlan.creative_lock?.non_negotiable_mechanism || ""),
      audience_tension: String(productionPlan.creative_lock?.audience_tension || ""),
      proof_requirement: String(productionPlan.creative_lock?.proof_requirement || ""),
    };

    productionPlan.editorial_logic = {
      opening_reason: String(productionPlan.editorial_logic?.opening_reason || ""),
      escalation: String(productionPlan.editorial_logic?.escalation || ""),
      payoff_reason: String(productionPlan.editorial_logic?.payoff_reason || ""),
      continuity_rule: String(productionPlan.editorial_logic?.continuity_rule || ""),
      shot_economy_rule: String(productionPlan.editorial_logic?.shot_economy_rule || ""),
    };

    productionPlan.script_qa = {
      passes_creative_lock: Boolean(productionPlan.script_qa?.passes_creative_lock),
      passes_business_truth: Boolean(productionPlan.script_qa?.passes_business_truth),
      passes_shot_feasibility: Boolean(productionPlan.script_qa?.passes_shot_feasibility),
      passes_cta_alignment: Boolean(productionPlan.script_qa?.passes_cta_alignment),
      summary: String(productionPlan.script_qa?.summary || ""),
    };

    productionPlan.script = {
      hook: String(productionPlan.script?.hook || ""),
      setup: String(productionPlan.script?.setup || ""),
      development: String(productionPlan.script?.development || ""),
      payoff: String(productionPlan.script?.payoff || ""),
      ending: String(productionPlan.script?.ending || ""),
      voiceover: String(
        productionPlan.voice?.script ||
          productionPlan.script?.voiceover ||
          ""
      ),
    };

    productionPlan.audio = {
      music_mood: String(
        productionPlan.music?.mood ||
          productionPlan.audio?.music_mood ||
          "Support the creative without overpowering speech"
      ),
      natural_sound: String(
        productionPlan.audio?.natural_sound ||
          "Use authentic source sound when it improves realism"
      ),
      sound_effects: String(
        productionPlan.sfx?.strategy ||
          productionPlan.audio?.sound_effects ||
          ""
      ),
      voiceover: String(
        productionPlan.voice?.script ||
          productionPlan.audio?.voiceover ||
          "None"
      ),
    };

    productionPlan.captions = {
      enabled: Boolean(
        productionPlan.captions_blueprint?.needed ??
          productionPlan.captions?.enabled
      ),
      style: String(
        productionPlan.captions_blueprint?.style ||
          productionPlan.captions?.style ||
          "Clean social captions"
      ),
      strategy: String(
        productionPlan.captions_blueprint?.emphasis_strategy ||
          productionPlan.captions?.strategy ||
          ""
      ),
    };

    productionPlan.shots = Array.isArray(productionPlan.shots)
      ? productionPlan.shots.map((shot: any) => ({
          ...shot,
          role: String(shot?.role || "STORY"),
          why: String(
            shot?.why ||
              shot?.description ||
              "Supports the creative objective"
          ),
          audio: String(
            shot?.audio || "Capture clean natural sound"
          ),
          on_screen_text: String(
            shot?.on_screen_text || ""
          ),
        }))
      : [];

    productionPlan.creative_brief = {
      raw_request: String(
        productionPlan.creative_brief?.raw_request || brief
      ),
      platform: String(
        productionPlan.creative_brief?.platform ||
          suppliedBrief.platform ||
          "Instagram Reels / TikTok"
      ),
      objective: String(
        productionPlan.creative_brief?.objective ||
          suppliedBrief.objective ||
          productionPlan.goal ||
          "Drive attention and action"
      ),
      audience: String(
        productionPlan.creative_brief?.audience ||
          suppliedBrief.audience ||
          "Social media viewers"
      ),
      desired_action: String(
        productionPlan.creative_brief?.desired_action ||
          suppliedBrief.desired_action ||
          "Take the next business action"
      ),
      core_message: String(
        productionPlan.creative_brief?.core_message ||
          suppliedBrief.core_message ||
          productionPlan.recommendation ||
          ""
      ),
      tone: String(
        productionPlan.creative_brief?.tone ||
          suppliedBrief.tone ||
          productionPlan.style ||
          "Modern"
      ),
      pacing: String(
        productionPlan.creative_brief?.pacing ||
          suppliedBrief.pacing ||
          "Fast"
      ),
      target_duration_seconds: Number(
        productionPlan.creative_brief?.target_duration_seconds ||
          suppliedBrief.target_duration_seconds ||
          productionPlan.duration_seconds ||
          15
      ),
      visual_style: String(
        productionPlan.creative_brief?.visual_style ||
          suppliedBrief.visual_style ||
          productionPlan.style ||
          "Social-first"
      ),
    };

    console.log("================================");
    console.log("ATLAS IDEAL BLUEPRINT READY");
    console.log("================================");
    console.log(
      JSON.stringify(
        {
          title: productionPlan.title,
          duration_seconds: productionPlan.duration_seconds,
          voice: productionPlan.voice,
          timeline: productionPlan.timeline,
          shot_requirements: productionPlan.shot_requirements,
        },
        null,
        2
      )
    );
    console.log("================================");

    return NextResponse.json(productionPlan);
  } catch (error) {
    console.error("ATLAS SCENE AI DIRECTOR ERROR:", error);

    const message =
      error instanceof Error
        ? error.message
        : "Unknown AI Director error.";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
