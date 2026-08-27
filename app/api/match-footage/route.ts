import OpenAI from "openai";
import { NextResponse } from "next/server";

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    matches: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          shot_number: { type: "string" },
          shot_title: { type: "string" },
          status: { type: "string", enum: ["MATCHED", "PARTIAL", "MISSING"] },
          clip_number: { type: ["integer", "null"] },
          filename: { type: "string" },
          confidence: { type: "number" },
          source_start: { type: "number" },
          source_end: { type: "number" },
          reason: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["shot_number", "shot_title", "status", "clip_number", "filename", "confidence", "source_start", "source_end", "reason", "recommendation"],
      },
    },
  },
  required: ["matches"],
};

export async function POST(request: Request) {
  try {
    if (!apiKey || !openai) {
      return NextResponse.json({ error: "OPENAI_API_KEY is missing." }, { status: 500 });
    }

    const body = await request.json();
    const plan = body?.production_plan;
    const analyses = Array.isArray(body?.analyses) ? body.analyses : [];
    const brief = body?.creative_brief ?? {};
    const businessProfile = body?.business_profile && typeof body.business_profile === "object" ? body.business_profile : {};

    if (!plan?.shots?.length || !analyses.length) {
      return NextResponse.json({ error: "Production shots and footage analysis are required." }, { status: 400 });
    }

    const prompt = `
You are ATLAS's footage matching director.

The Production Plan is the SOURCE OF TRUTH for what the final Reel is supposed to contain.
Your job is NOT to invent a new story. Match the available analyzed footage to the requested shots.

BUSINESS PROFILE:
${JSON.stringify(businessProfile, null, 2)}

CREATIVE BRIEF:
${JSON.stringify(brief, null, 2)}

REQUESTED PRODUCTION PLAN:
${JSON.stringify(plan.shots, null, 2)}

AVAILABLE FOOTAGE ANALYSIS:
${JSON.stringify(analyses, null, 2)}

RULES:
1. Every requested shot must receive exactly one result.
2. Use a real clip only when its analyzed content genuinely supports the requested shot.
3. MATCHED = strong usable match (confidence >= 80).
4. PARTIAL = usable with compromise (confidence 55-79).
5. MISSING = no honest match (confidence < 55). clip_number must be null and filename empty for MISSING.
6. Never pretend a generic clip is the requested shot just to fill the timeline.
7. Prefer the clip's suggested_start/suggested_end when they fit the requested shot.
8. source_start/source_end must stay inside that clip's analyzed duration.
9. If multiple clips fit, choose the one that best serves the original creative objective.
10. The recommendation should tell the user what to do next when the match is partial or missing.
11. Keep the original shot_number and shot_title.
12. Return ONLY JSON.
`;

    const response = await openai.responses.create({
      model: "gpt-5.4-mini",
      store: false,
      input: [
        { role: "system", content: [{ type: "input_text", text: prompt }] },
        { role: "user", content: [{ type: "input_text", text: "Match the footage to the production plan." }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "atlas_footage_match",
          strict: true,
          schema,
        },
      },
    });

    if (!response.output_text) throw new Error("OpenAI returned an empty footage match.");
    const parsed = JSON.parse(response.output_text);

    const durations = new Map<number, number>(
      analyses.map((a: any) => [Number(a.clip), Number(a.duration ?? 0)])
    );

    parsed.matches = Array.isArray(parsed.matches)
      ? parsed.matches.map((m: any) => {
          const clip = m.clip_number == null ? null : Number(m.clip_number);
          const duration = clip == null ? 0 : (durations.get(clip) ?? 0);
          const start = clip == null ? 0 : Math.max(0, Math.min(Number(m.source_start ?? 0), duration));
          const end = clip == null ? 0 : Math.max(start, Math.min(Number(m.source_end ?? duration), duration));
          return {
            shot_number: String(m.shot_number),
            shot_title: String(m.shot_title),
            status: ["MATCHED", "PARTIAL", "MISSING"].includes(m.status) ? m.status : "MISSING",
            clip_number: clip,
            filename: String(m.filename ?? ""),
            confidence: Math.max(0, Math.min(100, Number(m.confidence ?? 0))),
            source_start: start,
            source_end: end,
            reason: String(m.reason ?? ""),
            recommendation: String(m.recommendation ?? ""),
          };
        })
      : [];

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("ATLAS FOOTAGE MATCH ERROR:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Footage matching failed." }, { status: 500 });
  }
}
