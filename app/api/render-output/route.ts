import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import { readReviewVideo } from "@/app/lib/atlas/render-review-cache";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const reviewId = String(url.searchParams.get("reviewId") || "").trim();
    if (!reviewId) return NextResponse.json({ error: "Missing reviewId." }, { status: 400 });

    const filePath = await readReviewVideo(reviewId);
    const buffer = await fs.readFile(filePath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(buffer.length),
        "Content-Disposition": 'inline; filename="atlas-reel.mp4"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error: any) {
    console.error("ATLAS RENDER OUTPUT ERROR", error);
    return NextResponse.json(
      { error: error?.message || "Rendered video is no longer available." },
      { status: 404 }
    );
  }
}
