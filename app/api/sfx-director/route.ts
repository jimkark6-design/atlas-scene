import OpenAI from openai;
import { NextResponse } from nextserver;

export const runtime = nodejs;

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey  new OpenAI({ apiKey })  null;

const SFX_TYPES = [
  HOOK_IMPACT,
  WHOOSH,
  WATER,
  FOAM,
  WIPE,
  MACHINE,
  REVEAL_IMPACT,
  CTA_HIT,
  CLICK,
  POP,
  NONE,
] as const;

const schema = {
  type object,
  additionalProperties false,
  properties {
    events {
      type array,
      maxItems 8,
      items {
        type object,
        additionalProperties false,
        properties {
          beat_id { type string },
          type {
            type string,
            enum [...SFX_TYPES],
          },
          at { type number },
          duration { type number },
          volume { type number },
          reason { type string },
        },
        required [
          beat_id,
          type,
          at,
          duration,
          volume,
          reason,
        ],
      },
    },
  },
  required [events],
} as const;

function clamp(value number, min number, max number) {
  return Math.max(min, Math.min(max, value));
}

function cleanType(value unknown) {
  const type = String(value  NONE).toUpperCase();
  return (SFX_TYPES as readonly string[]).includes(type)
     type
     NONE;
}

function normalizeEvents(events any[], timeline any[]) {
  const byId = new Map(
    timeline.map((beat any) = [String(beat.id), beat]),
  );

  const result any[] = [];

  for (const raw of Array.isArray(events)  events  []) {
    const beatId = String(raw.beat_id  );
    const beat = byId.get(beatId);

    if (!beat) continue;

    const type = cleanType(raw.type);

    if (type === NONE) continue;

    const beatDuration = Math.max(
      0.25,
      Number(beat.source_end) - Number(beat.source_start),
    );

    const at = clamp(
      Number(raw.at)  0,
      0,
      Math.max(0, beatDuration - 0.08),
    );

    const duration = clamp(
      Number(raw.duration)  0.55,
      0.20,
      Math.min(1.0, beatDuration),
    );

    const volume = clamp(
      Number(raw.volume)  0.14,
      0.05,
      0.28,
    );

    result.push({
      beat_id beatId,
      type,
      at Number(at.toFixed(3)),
      duration Number(duration.toFixed(3)),
      volume Number(volume.toFixed(3)),
      reason String(raw.reason  ).slice(0, 240),
    });
  }

   Never allow two events to fire almost simultaneously.
  result.sort((a, b) = {
    const beatA = timeline.findIndex(
      (x any) = String(x.id) === a.beat_id,
    );
    const beatB = timeline.findIndex(
      (x any) = String(x.id) === b.beat_id,
    );

    if (beatA !== beatB) return beatA - beatB;
    return a.at - b.at;
  });

  const filtered any[] = [];

  for (const event of result) {
    const previous = filtered[filtered.length - 1];

    if (
      previous &&
      previous.beat_id === event.beat_id &&
      Math.abs(previous.at - event.at)  0.20
    ) {
      continue;
    }

    filtered.push(event);
  }

  return filtered.slice(0, 8);
}

export async function POST(request Request) {
  try {
    if (!openai  !apiKey) {
      return NextResponse.json(
        { error OPENAI_API_KEY is missing. },
        { status 500 },
      );
    }

    const body = await request.json();

    const timeline = Array.isArray(body.timeline)
       body.timeline
       [];

    const analyses = Array.isArray(body.analyses)
       body.analyses
       [];

    const matches = Array.isArray(body.footage_matches)
       body.footage_matches
       [];

    const masterPlan = body.master_plan  {};
    const creativeBrief = body.creative_brief  {};

    if (!timeline.length) {
      return NextResponse.json(
        { error Timeline is required. },
        { status 400 },
      );
    }

    console.log(
      `[ATLAS SFX DIRECTOR] START  beats=${timeline.length}`,
    );

    const prompt = `
You are ATLAS AI SFX DIRECTOR V1.

You are NOT a generic sound-effects picker.

You are the sound designer for a premium commercial editor.

Your job is to design a SMALL, precise, cinematic SFX layer that reinforces
what is visibly happening in the edit.

IMPORTANT
- The finished reel must NOT sound like a template.
- Silence is often better than an SFX.
- Never add a sound just because a beat exists.
- Every SFX must have a visibleeditorial reason.
- Prefer subtle realistic physical sounds over exaggerated cartoon sounds.
- SFX must support the visual rhythm, not fight the voice.
- Voice has highest priority.
- Music has higher priority than SFX.
- SFX should normally sit around 0.08–0.24 volume.
- Never use more than 8 total SFX.
- Never place two SFX within 0.20 seconds of each other on the same beat.
- Most beats should have 0 or 1 SFX.
- Maximum 2 SFX on a beat only when there is a real compound action.
- CTA should normally have one subtle CTA_HIT or CLICK, not both.
- Avoid repetitive WHOOSHIMPACT patterns.
- Do not use SFX to compensate for bad editing.

SFX VOCABULARY

HOOK_IMPACT
Strong opening editorial hit.

WHOOSH
Fast movement, camera movement, transition or reveal.

WATER
Waterspraypressure-washing action.

FOAM
Foamsoap application.

WIPE
Microfiberwipingbrushingsurface cleaning motion.

MACHINE
Machinepolishertool action.

REVEAL_IMPACT
Transformationreveal moment.

CTA_HIT
Subtle final commercial accent.

CLICK
Buttoncontactbooking style accent.

POP
Small detailreveal accent.

NONE
No sound.

CRITICAL
Do not invent an action that is not supported by the footage analysis.

CREATIVE BRIEF
${JSON.stringify(creativeBrief, null, 2)}

MASTER PLAN
${JSON.stringify(masterPlan, null, 2)}

FOOTAGE ANALYSIS
${JSON.stringify(analyses, null, 2)}

FOOTAGE MATCHES
${JSON.stringify(matches, null, 2)}

EXECUTABLE TIMELINE
${JSON.stringify(timeline, null, 2)}

For every proposed SFX decide

1. Is there a real visible action
2. Does the SFX improve the edit
3. Is the timing tied to the action peakrevealcut
4. Would silence be better

If silence is better, output nothing for that beat.

TIMING
'at' is relative to the beginning of that beat.

DURATION
Use short realistic durations, normally 0.25–0.80 seconds.

VOLUME
Keep it subtle. Normally 0.10–0.20.
Only use up to 0.24 for a genuine hero impact.

Return ONLY JSON.
`;

    const response = await openai.responses.create({
      model gpt-5.4-mini,
      store false,
      input [
        {
          role user,
          content prompt,
        },
      ],
      text {
        format {
          type json_schema,
          name atlas_ai_sfx_director_v1,
          strict true,
          schema,
        },
      },
    });

    if (!response.output_text) {
      throw new Error(AI SFX Director returned no result.);
    }

    const raw = JSON.parse(response.output_text);

    const events = normalizeEvents(
      raw.events  [],
      timeline,
    );

    console.log(
      `[ATLAS SFX DIRECTOR] COMPLETE  generatedEvents=${events.length}`,
    );

    for (const event of events) {
      console.log(
        `[ATLAS AI SFX] ${event.beat_id}  ${event.type}  at=${event.at.toFixed(
          2,
        )}  volume=${event.volume.toFixed(2)}  ${event.reason}`,
      );
    }

    return NextResponse.json({
      success true,
      enabled true,
      events,
      stats {
        generated events.length,
        max 8,
      },
    });
  } catch (error any) {
    console.error([ATLAS SFX DIRECTOR] ERROR, error);

    return NextResponse.json(
      {
        error
          error.message 
          ATLAS AI SFX Director failed.,
      },
      { status 500 },
    );
  }
}