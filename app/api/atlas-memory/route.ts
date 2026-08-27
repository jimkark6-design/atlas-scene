import { NextResponse } from "next/server";
import { memoryForPrompt, readAtlasMemory, recordAtlasReview } from "@/app/lib/atlas/atlas-memory";

export const runtime = "nodejs";

export async function GET() {
  const memory = await readAtlasMemory();
  return NextResponse.json({ success: true, memory });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const memory = await recordAtlasReview(body?.review || body || {});
    return NextResponse.json({ success: true, memory, prompt_context: memoryForPrompt(memory) });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "ATLAS memory update failed." }, { status: 500 });
  }
}
