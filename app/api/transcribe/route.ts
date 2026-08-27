import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);

interface CaptionSegment {
  filename: string;
  start: number;
  end: number;
  text: string;
  words?: { word: string; start: number; end: number }[];
}


async function findFfmpeg(): Promise<string> {
  const candidates = [process.env.FFMPEG_PATH, "ffmpeg", "ffmpeg.exe"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["-version"], { windowsHide: true });
      return candidate;
    } catch {}
  }
  throw new Error("FFmpeg executable was not found for transcription audio extraction.");
}

async function hasUsableAudioStream(inputPath: string, ffmpeg: string): Promise<boolean> {
  try {
    await execFileAsync(ffmpeg, ["-hide_banner", "-i", inputPath], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return false;
  } catch (error: any) {
    const text = `${error?.stdout || ""}\n${error?.stderr || ""}`;
    return /Stream #[^\n]+Audio:/i.test(text);
  }
}

async function prepareAudioForTranscription(file: File, ffmpeg: string) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "atlas-transcribe-"));
  const safeName = file.name.replace(/[^\\w.-]+/g, "_");
  const inputPath = path.join(tempDir, safeName);
  const outputPath = path.join(tempDir, "audio.mp3");

  await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

  const hasAudio = await hasUsableAudioStream(inputPath, ffmpeg);
  if (!hasAudio) {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return null;
  }

  await execFileAsync(ffmpeg, [
    "-y", "-i", inputPath, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "libmp3lame", "-b:a", "24k", outputPath,
  ], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });

  const audio = await fs.readFile(outputPath);
  return {
    audio: new File([audio], `${path.parse(file.name).name}.mp3`, { type: "audio/mpeg" }),
    cleanup: () => fs.rm(tempDir, { recursive: true, force: true }),
  };
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "OPENAI_API_KEY is missing. Add it to .env.local before using speech captions.",
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const files = formData
      .getAll("clips")
      .filter((value): value is File => value instanceof File);

    if (!files.length) {
      return NextResponse.json(
        { error: "No video clips were uploaded." },
        { status: 400 }
      );
    }

    const captions: CaptionSegment[] = [];

    for (const file of files) {
      console.log("ATLAS TRANSCRIBE:", file.name, file.size, "bytes");

      let prepared: Awaited<ReturnType<typeof prepareAudioForTranscription>> | null = null;
      let response: Response;
      try {
        const ffmpeg = await findFfmpeg();
        prepared = await prepareAudioForTranscription(file, ffmpeg);
        if (!prepared) {
          console.warn(`ATLAS TRANSCRIBE SKIP: ${file.name} has no audio stream. Continuing with visual-only footage.`);
          continue;
        }
        console.log("ATLAS TRANSCRIBE AUDIO:", file.name, "video=", file.size, "bytes audio=", prepared.audio.size, "bytes");

        const body = new FormData();
        body.append("file", prepared.audio, prepared.audio.name);
        body.append("model", "whisper-1");
        body.append("response_format", "verbose_json");
        body.append("temperature", "0");
        body.append("timestamp_granularities[]", "segment");
        body.append("timestamp_granularities[]", "word");

        response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body,
        });
      } finally {
        if (prepared) await prepared.cleanup().catch(() => {});
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          "ATLAS TRANSCRIBE ERROR:",
          file.name,
          errorText
        );

        /*
         * Some footage is intentionally silent / has an audio stream that
         * the transcription service cannot decode. That must NOT kill the
         * whole Reel pipeline: ATLAS can still use that clip visually.
         *
         * OpenAI returns these cases as an invalid_request_error with
         * messages such as "audio file could not be decoded", "duration: 0",
         * or "format is not supported".
         */
        const lowerError = errorText.toLowerCase();

        const isNonTranscribableMedia =
          lowerError.includes("audio file could not be decoded") ||
          lowerError.includes("format is not supported") ||
          lowerError.includes('"duration":0') ||
          lowerError.includes('"duration": 0') ||
          lowerError.includes("duration: 0") ||
          lowerError.includes("no audio") ||
          lowerError.includes("audio stream");

        if (isNonTranscribableMedia) {
          console.warn(
            `ATLAS TRANSCRIBE SKIP: ${file.name} has no usable audio. Continuing without captions for this clip.`
          );
          continue;
        }

        // Real API/auth/request failures remain fatal.
        return NextResponse.json(
          {
            error:
              `Speech transcription failed for ${file.name}. ${errorText}`,
          },
          { status: 502 }
        );
      }

      const data = await response.json();

      const segments = Array.isArray(data?.segments)
        ? data.segments
        : [];

      if (segments.length === 0) {
        console.log(
          `ATLAS TRANSCRIBE: ${file.name} returned no usable speech segments.`
        );
      }

      for (const segment of segments) {
        const text = String(segment?.text || "").trim();
        const start = Number(segment?.start);
        const end = Number(segment?.end);

        if (
          !text ||
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          end <= start
        ) {
          continue;
        }

        captions.push({
          filename: file.name,
          start,
          end,
          text,
          words: Array.isArray(data?.words)
            ? data.words
                .filter((w: any) => Number.isFinite(Number(w?.start)) && Number.isFinite(Number(w?.end)) && Number(w.end) > Number(w.start))
                .filter((w: any) => Number(w.start) < end && Number(w.end) > start)
                .map((w: any) => ({
                  word: String(w?.word || "").trim(),
                  start: Math.max(start, Number(w.start)),
                  end: Math.min(end, Number(w.end)),
                }))
                .filter((w: any) => w.word && w.end > w.start)
            : [],
        });
      }
    }

    console.log(
      "ATLAS TRANSCRIBE COMPLETE:",
      captions.length,
      "caption segments"
    );

    return NextResponse.json({
      captions,
    });
  } catch (error: any) {
    console.error("ATLAS TRANSCRIBE ERROR:", error);

    return NextResponse.json(
      {
        error:
          error?.message ||
          "ATLAS speech transcription failed.",
      },
      { status: 500 }
    );
  }
}
