import { NextRequest, NextResponse } from "next/server";

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

type PlannedClip = {
  order: number;
  clip: number;
  filename: string;
  role: "HOOK" | "STORY" | "CTA";
  start: number;
  end: number;
  duration: number;
  score: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cleanCandidate(
  item: any,
  source: ClipAnalysis,
  order: number,
  role: PlannedClip["role"]
): PlannedClip {
  const sourceDuration = Number(source.duration) || 0;

  let start = Number(item?.start);
  let end = Number(item?.end);

  if (!Number.isFinite(start)) {
    start = Number(source.suggested_start);
  }

  if (!Number.isFinite(start)) {
    start = 0;
  }

  if (!Number.isFinite(end)) {
    end = Number(source.suggested_end);
  }

  if (!Number.isFinite(end)) {
    end = start + 3;
  }

  start = clamp(start, 0, Math.max(0, sourceDuration - 0.25));

  if (sourceDuration > 0) {
    end = clamp(end, start + 0.8, sourceDuration);
  } else {
    end = Math.max(start + 0.8, end);
  }

  // Social-first pacing: don't let one shot dominate the Reel.
  const maxDuration =
    role === "HOOK"
      ? 3.5
      : role === "CTA"
        ? 3
        : 4.5;

  if (end - start > maxDuration) {
    end = Math.min(
      sourceDuration || start + maxDuration,
      start + maxDuration
    );
  }

  return {
    order,
    clip: source.clip,
    filename: source.filename,
    role,
    start: Number(start.toFixed(3)),
    end: Number(end.toFixed(3)),
    duration: Number((end - start).toFixed(3)),
    score: Number(source.score) || 0,
  };
}

function chooseRole(
  source: ClipAnalysis,
  position: number,
  total: number
): PlannedClip["role"] {
  if (position === 0) return "HOOK";
  if (position === total - 1) return "CTA";
  return "STORY";
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const clips: ClipAnalysis[] = Array.isArray(body?.clips)
      ? body.clips
      : [];

    if (!clips.length) {
      return NextResponse.json(
        { error: "No analyzed clips were provided." },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is missing." },
        { status: 500 }
      );
    }

    const usable = clips
      .filter((clip) => {
        const verdict = String(clip.verdict || "").toLowerCase();
        return (
          clip.filename &&
          verdict !== "reject" &&
          Number(clip.score) >= 45
        );
      })
      .sort(
        (a, b) =>
          Number(b.score || 0) -
          Number(a.score || 0)
      );

    const pool = usable.length ? usable : clips;

    const input = pool.map((clip) => ({
      clip: clip.clip,
      filename: clip.filename,
      duration: clip.duration,
      score: clip.score,
      verdict: clip.verdict,
      shot_type: clip.shot_type,
      reason: clip.reason,
      strengths: clip.strengths || [],
      problems: clip.problems || [],
      recommended_use: clip.recommended_use || "",
      suggested_start: clip.suggested_start,
      suggested_end: clip.suggested_end,
    }));

    const captions = Array.isArray(body?.captions)
      ? body.captions
          .filter(
            (c: any) =>
              c &&
              typeof c.filename === "string" &&
              typeof c.text === "string"
          )
          .map((c: any) => ({
            filename: c.filename,
            start: Number(c.start) || 0,
            end: Number(c.end) || 0,
            text: String(c.text).trim(),
          }))
          .filter(
            (c: any) => c.text && c.end > c.start
          )
      : [];

    const systemPrompt = `
You are ATLAS, an expert short-form video editor and retention strategist.

Your job is to design a COMPLETE 9:16 Reel, not merely rank clips.

EDITORIAL RULES
1. HOOK: the first 1–2 seconds must stop the scroll. Prefer a close/detail/action shot or a strong spoken moment. Avoid greetings, silence, loading, setup and dead air.
2. STORY: build a progression: HOOK → CONTEXT/SETUP → PAYOFF/PROOF → CTA when footage supports it.
3. RETENTION: change meaningful visual information roughly every 1.5–4 seconds when useful. Avoid redundant shots.
4. SPEECH: when transcript is available, prefer curiosity, claims, benefits, emotion or strong statements. Avoid filler and awkward sentence fragments.
5. VISUAL QUALITY: reject footage marked reject; avoid screen captures, UI, loading frames, severe blur, watermarks and weak framing.
6. DIVERSITY: use each source filename at most once and prefer complementary shot types.
7. PACING: target 8–16 seconds when enough good footage exists. Prefer 3–5 shots with 3+ good sources. Never add a weak shot just to hit a count.
8. TIMING: use suggested timestamps as guidance, but choose the strongest specific moment inside the source duration.
9. CTA: finish with a meaningful conclusion or strongest payoff. Do not invent a sales CTA when none exists.
10. Never invent footage, dialogue or timestamps.

Return JSON only.
`;

    const userPrompt = `
Here is the analyzed footage:

${JSON.stringify(input, null, 2)}

Speech transcript available for the uploaded footage:
${JSON.stringify(captions, null, 2)}

Create an edit plan.

Return exactly this shape:
{
  "success": true,
  "mode": "AI STORY EDIT",
  "recommendation": "one short sentence describing the editorial strategy",
  "clips": [
    {
      "clip": 1,
      "filename": "exact filename",
      "start": 0.0,
      "end": 3.0
    }
  ]
}

Important:
- The "clips" array is the EDIT SEQUENCE, not the upload order.
- Select multiple clips when the footage supports it.
- Prefer 3–5 complementary shots when at least 3 good sources exist.
- For 2 good sources, use both if they create meaningful progression.
- Never select a rejected source.
- Do not output role/order/duration/score; ATLAS will calculate those.
`;

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          temperature: 0.35,
          response_format: {
            type: "json_object",
          },
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: userPrompt,
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        "ATLAS edit-plan OpenAI error:",
        errorText
      );

      return NextResponse.json(
        {
          error:
            "ATLAS could not generate the edit plan.",
        },
        { status: 502 }
      );
    }

    const result = await response.json();

    const content =
      result?.choices?.[0]?.message?.content;

    if (typeof content !== "string") {
      throw new Error(
        "OpenAI returned no edit-plan content."
      );
    }

    const parsed = JSON.parse(content);

    const sourceByFilename = new Map(
      pool.map((clip) => [
        clip.filename,
        clip,
      ])
    );

    const sourceByClip = new Map(
      pool.map((clip) => [
        clip.clip,
        clip,
      ])
    );

    const rawSequence = Array.isArray(parsed?.clips)
      ? parsed.clips
      : [];

    const used = new Set<string>();

    const selectedSources: Array<{
      source: ClipAnalysis;
      item: any;
    }> = [];

    for (const item of rawSequence) {
      const filename =
        typeof item?.filename === "string"
          ? item.filename
          : "";

      const source =
        sourceByFilename.get(filename) ||
        sourceByClip.get(Number(item?.clip));

      if (!source) continue;

      const key = source.filename;

      if (used.has(key)) continue;

      used.add(key);

      selectedSources.push({
        source,
        item,
      });

      if (selectedSources.length >= 5) break;
    }

    // If the model returned too few shots, add genuinely complementary
    // sources rather than blindly taking the next highest score.
    const complementRank = (source: ClipAnalysis) => {
      const type = String(source.shot_type || "").toLowerCase();
      let bonus = 0;
      if (type.includes("detail") || type.includes("close") || type.includes("product")) bonus += 14;
      if (type.includes("hero") || type.includes("lifestyle") || type.includes("wide")) bonus += 8;
      if (type.includes("action") || type.includes("motion")) bonus += 10;
      if (String(source.verdict).toLowerCase() === "excellent") bonus += 8;
      return Number(source.score || 0) + bonus;
    };

    const fallbackPool = [...pool].sort(
      (a, b) => complementRank(b) - complementRank(a)
    );

    for (const source of fallbackPool) {
      if (selectedSources.length >= Math.min(5, fallbackPool.length)) break;
      if (used.has(source.filename)) continue;
      if (String(source.verdict).toLowerCase() === "reject") continue;

      used.add(source.filename);
      selectedSources.push({
        source,
        item: {
          start: source.suggested_start,
          end: source.suggested_end,
        },
      });
    }

    if (!selectedSources.length) {
      throw new Error(
        "ATLAS could not map the AI edit plan back to the analyzed clips."
      );
    }

    // Never allow a 2-shot Reel to become HOOK + HOOK.
    // The sequence itself defines the story roles.
    const planned: PlannedClip[] =
      selectedSources.map(
        ({ source, item }, index) => {
          const role = chooseRole(
            source,
            index,
            selectedSources.length
          );

          return cleanCandidate(
            item,
            source,
            index + 1,
            role
          );
        }
      );

    // CTA should be a distinct final shot when possible.
    // If the final source is obviously a detail/product shot,
    // it still works as the visual payoff/CTA.
    const totalDuration = Number(
      planned
        .reduce(
          (sum, clip) =>
            sum + clip.duration,
          0
        )
        .toFixed(2)
    );

    const plan = {
      success: true,
      mode: "AI STORY EDIT",
      recommendation:
        typeof parsed?.recommendation === "string"
          ? parsed.recommendation
          : "Fast hook → story/detail payoff → strong ending.",
      totalDuration,
      clips: planned,
    };

    console.log(
      "================================"
    );
    console.log(
      "ATLAS AI STORY EDIT PLAN V2"
    );
    console.log(
      JSON.stringify(plan, null, 2)
    );
    console.log(
      "================================"
    );

    return NextResponse.json(plan);
  } catch (error: any) {
    console.error(
      "ATLAS edit-plan error:",
      error
    );

    return NextResponse.json(
      {
        error:
          error?.message ||
          "ATLAS edit-plan failed.",
      },
      { status: 500 }
    );
  }
}
