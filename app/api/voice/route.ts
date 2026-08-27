import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

export async function POST(request: Request) {
  try {
    if (!openai || !apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY is missing." }, { status: 500 });
    }

    const body = await request.json();
    const script = String(body?.script || "").trim();
    const voice = String(body?.voice || "coral");
    const instructions = String(
      body?.instructions ||
      "Natural, clear, confident short-form commercial voiceover. Speak briskly and naturally, with energetic pacing, clean pronunciation, and no unnecessary pauses. Prioritize fitting a 15-second social Reel when the script is written for that duration."
    );

    if (!script) {
      return NextResponse.json({ error: "No voice script was provided." }, { status: 400 });
    }

    if (script.length > 4096) {
      return NextResponse.json({ error: "Voice script is too long (4096 characters max)." }, { status: 400 });
    }

    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice,
      input: script,
      instructions,
      response_format: "mp3",
    });

    const buffer = Buffer.from(await response.arrayBuffer());

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("ATLAS AI VOICE ERROR:", error);
    return NextResponse.json(
      { error: error?.message || "AI voice generation failed." },
      { status: 500 }
    );
  }
}
