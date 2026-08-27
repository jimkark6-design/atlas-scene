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
    title: {
      type: "string",
    },

    duration_seconds: {
      type: "integer",
    },

    format: {
      type: "string",
    },

    goal: {
      type: "string",
    },

    style: {
      type: "string",
    },

    recommendation: { type: "string" },
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
      required: ["hook", "setup", "development", "payoff", "ending", "voiceover"],
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
      required: ["music_mood", "natural_sound", "sound_effects", "voiceover"],
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
      type: "object", additionalProperties: false,
      properties: {
        raw_request: { type: "string" }, platform: { type: "string" }, objective: { type: "string" }, audience: { type: "string" }, desired_action: { type: "string" }, core_message: { type: "string" }, tone: { type: "string" }, pacing: { type: "string" }, target_duration_seconds: { type: "integer" }, visual_style: { type: "string" },
      },
      required: ["raw_request","platform","objective","audience","desired_action","core_message","tone","pacing","target_duration_seconds","visual_style"],
    },

    shots: {
      type: "array",
      minItems: 3,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          number: {
            type: "string",
          },

          title: {
            type: "string",
          },

          duration: {
            type: "string",
          },

          description: {
            type: "string",
          },

          instruction: {
            type: "string",
            minLength: 500,
          },

          camera_movement: {
            type: "string",
            minLength: 60,
          },

          framing: {
            type: "string",
            minLength: 60,
          },
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
    "shots",
  ],
};

export async function POST(request: Request) {
  try {
    // -----------------------------------------
    // CHECK API KEY
    // -----------------------------------------

    if (!apiKey || !openai) {
      return NextResponse.json(
        {
          error:
            "OPENAI_API_KEY is missing. Add it to .env.local and restart the server.",
        },
        {
          status: 500,
        }
      );
    }

    // -----------------------------------------
    // READ USER BRIEF
    // -----------------------------------------

    const body = await request.json();

    const brief = body?.brief;
    const suppliedBrief = body?.creative_brief && typeof body.creative_brief === "object" ? body.creative_brief : {};

    if (!brief || typeof brief !== "string") {
      return NextResponse.json(
        {
          error: "A content brief is required.",
        },
        {
          status: 400,
        }
      );
    }

    // -----------------------------------------
    // BUSINESS CONTEXT
    // -----------------------------------------

    const business = {
      name: "Burger House",
      category: "Restaurant",
      style: "Premium · Urban",
      location: "Greece",
      audience:
        "Local customers and people discovering the restaurant through social media",
    };

    // -----------------------------------------
    // AI DIRECTOR PROMPT
    // -----------------------------------------

    const systemPrompt = `
You are ATLAS SCENE.

You are an expert AI creative director for small and medium-sized businesses.

Your job is to transform a business owner's natural-language request into a practical production plan.

You are NOT simply a script writer.

You are the creative director responsible for deciding:

- What content should be created
- What the content should accomplish
- What format should be used
- What visual style fits
- How long it should be
- What shots are needed
- What the business owner needs to physically film
- How every shot should be filmed

BUSINESS CONTEXT:

Business name:
${business.name}

Business category:
${business.category}

Brand style:
${business.style}

Location:
${business.location}

Target audience:
${business.audience}

USER REQUEST:

${brief}

STRUCTURED CREATIVE BRIEF (SOURCE OF TRUTH):
${JSON.stringify(suppliedBrief, null, 2)}

IMPORTANT RULES:

1. Understand the user's actual intention.

2. Do not require the user to know marketing terminology.

3. If the request is vague, make sensible creative decisions yourself.

4. Automatically choose the most appropriate social media format.

5. Create a strong concept with a memorable title.

6. Create between 3 and 8 shots.

7. Every shot must be realistically filmable using a normal smartphone.
7a. Write the complete viewer-facing story structure: hook, setup, development, payoff, ending.
7b. If spoken words are useful, write a concise voiceover/dialogue direction; if not, return an empty voiceover and rely on visuals.
7c. Give a concrete audio direction and caption strategy before filming.

8. Give extremely practical, beginner-proof filming instructions. The person filming may know NOTHING about video production and must be able to follow the instructions directly from a phone screen.

9. Keep the requested number of SOURCE CLIPS LOW: normally 4–6 source clips for a 12–20 second Reel. Do not request redundant clips.

10. duration means RAW RECORDING TIME. Normally ask for 5–8 seconds of raw footage per source clip so ATLAS has handles for editing.

11. EVERY shot's instruction MUST be written as a structured mini checklist using EXACTLY these headings and in this order:
WHAT TO FILM:
PHONE SETUP:
START:
ACTION:
END:
LIGHT:
AVOID:
RECORD:
Each heading must contain concrete, physical instructions. Do not leave any heading empty.
The final instruction string MUST visibly contain all eight labels exactly as written above. Do not compress them into a paragraph and do not omit labels even when a shot seems simple. Each label must be followed by at least one full sentence.

12. WHAT TO FILM must say exactly what object/person/action should appear.

13. PHONE SETUP must specify vertical 9:16, rear camera when possible, approximate distance, approximate height/angle, and where the subject should sit in frame.

14. START must tell the user what to prepare BEFORE pressing record.

15. ACTION must tell the user exactly what to do DURING the take, including movement direction and speed.

16. END must tell the user exactly how the take finishes and what the final frame should look like.

17. LIGHT must give simple practical lighting advice using available light. Do not assume professional lighting equipment.

18. AVOID must list 2–4 concrete beginner mistakes to avoid.

19. RECORD must explicitly state the RAW recording length in seconds.

20. camera_movement MUST describe physical movement: starting position, ending position, direction and speed. If static, explicitly say "keep the phone completely still".

21. framing MUST specify the 9:16 framing, approximate distance/height/angle, what must be fully visible, and what must not be cropped.

22. why MUST explain the business/editorial purpose in plain language.

23. Do NOT use vague filmmaking language by itself, including "close-up", "cinematic", "slow push-in", "nice shot", or "capture the product". Translate every such term into physical phone actions.

24. The user experience must read like:
DO THIS → NOW DO THIS → NOW MOVE HERE → HOLD → STOP.
The user must not need to ask a follow-up question to film the shot.

25. The result should feel like it was created by a professional social media creative director.

25. Treat the structured creative brief as the primary creative constraint. Do not silently change the objective, audience, desired action, tone, pacing or target duration.

26. Preserve supplied brief values unless a field is empty. The later AI editor will use this brief as the source of truth for every footage decision.

27. Return ONLY the structured JSON object requested by the application.
`;

    // -----------------------------------------
    // OPENAI REQUEST
    // -----------------------------------------

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
          name: "atlas_scene_production_plan",
          strict: true,
          schema: productionPlanSchema,
        },
      },
    });

    // -----------------------------------------
    // GET MODEL OUTPUT
    // -----------------------------------------

    console.log("ATLAS PRODUCTION PLAN ROUTE: SHOOT-COACH-ACTIVE-V6");
    const outputText = response.output_text;

    if (!outputText) {
      throw new Error(
        "OpenAI returned an empty production plan."
      );
    }

    // -----------------------------------------
    // PARSE JSON
    // -----------------------------------------

    let productionPlan;

    try {
      productionPlan = JSON.parse(outputText);
    } catch {
      console.error(
        "INVALID OPENAI OUTPUT:",
        outputText
      );

      throw new Error(
        "OpenAI returned invalid production data."
      );
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

    const weakShot = Array.isArray(productionPlan?.shots)
      ? productionPlan.shots.find((shot: any) => {
          const instruction =
            typeof shot?.instruction === "string"
              ? shot.instruction
              : "";

          return (
            instruction.trim().length < 500 ||
            requiredShootLabels.some(
              (label) => !instruction.includes(label)
            ) ||
            typeof shot?.camera_movement !== "string" ||
            shot.camera_movement.trim().length < 60 ||
            typeof shot?.framing !== "string" ||
            shot.framing.trim().length < 60 ||
            typeof shot?.why !== "string" ||
            shot.why.trim().length < 60
          );
        })
      : null;

    if (weakShot) {
      throw new Error(
        `ATLAS generated incomplete shooting instructions for shot ${String(
          weakShot?.number || "unknown"
        )}. The active production-plan route requires WHAT TO FILM / PHONE SETUP / START / ACTION / END / LIGHT / AVOID / RECORD.`
      );
    }

    productionPlan.script = {
      hook: String(productionPlan.script?.hook || ""),
      setup: String(productionPlan.script?.setup || ""),
      development: String(productionPlan.script?.development || ""),
      payoff: String(productionPlan.script?.payoff || ""),
      ending: String(productionPlan.script?.ending || ""),
      voiceover: String(productionPlan.script?.voiceover || ""),
    };
    productionPlan.audio = {
      music_mood: String(productionPlan.audio?.music_mood || "Support the tone without overpowering speech"),
      natural_sound: String(productionPlan.audio?.natural_sound || "Capture clean source sound where it helps"),
      sound_effects: String(productionPlan.audio?.sound_effects || ""),
      voiceover: String(productionPlan.audio?.voiceover || productionPlan.script.voiceover || "None"),
    };
    productionPlan.captions = {
      enabled: Boolean(productionPlan.captions?.enabled),
      style: String(productionPlan.captions?.style || "Clean social captions"),
      strategy: String(productionPlan.captions?.strategy || "Use concise captions only when speech or message benefits from them"),
    };
    productionPlan.shots = Array.isArray(productionPlan.shots)
      ? productionPlan.shots.map((shot: any) => ({
          ...shot,
          role: String(shot?.role || "STORY"),
          why: String(shot?.why || shot?.description || "Supports the story"),
          audio: String(shot?.audio || "Capture clean natural sound"),
          on_screen_text: String(shot?.on_screen_text || ""),
        }))
      : [];

    productionPlan.creative_brief = {
      raw_request: String(productionPlan.creative_brief?.raw_request || brief),
      platform: String(productionPlan.creative_brief?.platform || suppliedBrief.platform || "Instagram Reels / TikTok"),
      objective: String(productionPlan.creative_brief?.objective || suppliedBrief.objective || productionPlan.goal || "Drive attention and action"),
      audience: String(productionPlan.creative_brief?.audience || suppliedBrief.audience || "Social media viewers"),
      desired_action: String(productionPlan.creative_brief?.desired_action || suppliedBrief.desired_action || "Take the next business action"),
      core_message: String(productionPlan.creative_brief?.core_message || suppliedBrief.core_message || productionPlan.recommendation || ""),
      tone: String(productionPlan.creative_brief?.tone || suppliedBrief.tone || productionPlan.style || "Modern"),
      pacing: String(productionPlan.creative_brief?.pacing || suppliedBrief.pacing || "Fast"),
      target_duration_seconds: Number(productionPlan.creative_brief?.target_duration_seconds || suppliedBrief.target_duration_seconds || productionPlan.duration_seconds || 18),
      visual_style: String(productionPlan.creative_brief?.visual_style || suppliedBrief.visual_style || productionPlan.style || "Social-first"),
    };

    return NextResponse.json(productionPlan);
  } catch (error) {
    console.error(
      "ATLAS SCENE AI DIRECTOR ERROR:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unknown AI Director error.";

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      }
    );
  }
}