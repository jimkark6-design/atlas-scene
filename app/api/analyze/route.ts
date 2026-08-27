import { NextResponse } from "next/server";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type Analysis = {
  clip: number;
  filename: string;
  duration: number;
  score: number;
  verdict:
    | "excellent"
    | "good"
    | "review"
    | "reject";
  shot_type: string;
  reason: string;
  strengths: string[];
  problems: string[];
  recommended_use: string;
  suggested_start: number;
  suggested_end: number;
};

async function findFFmpeg(): Promise<string> {
  const cwd = process.cwd();

  const candidates = [
    // Explicit environment variable
    process.env.FFMPEG_PATH,

    // ffmpeg-static inside current project
    path.resolve(
      cwd,
      "node_modules",
      "ffmpeg-static",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    ),

    // Possible nested project location
    path.resolve(
      cwd,
      "atlas-scene",
      "node_modules",
      "ffmpeg-static",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    ),

    // System PATH executable
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      // If this is a PATH command, verify that it can actually execute.
      if (
        candidate === "ffmpeg.exe" ||
        candidate === "ffmpeg"
      ) {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            candidate,
            ["-version"],
            {
              windowsHide: true,
            }
          );

          let stderr = "";

          child.stderr.on("data", (data) => {
            stderr += data.toString();
          });

          child.on("error", reject);

          child.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(
                new Error(
                  stderr ||
                    `FFmpeg exited with code ${code}`
                )
              );
            }
          });
        });

        console.log(
          "ATLAS VISION FOUND FFMPEG FROM PATH:",
          candidate
        );

        return candidate;
      }

      await fs.access(candidate);

      console.log(
        "ATLAS VISION FOUND FFMPEG:",
        candidate
      );

      return candidate;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(
    "FFmpeg executable was not found. Checked FFMPEG_PATH, ffmpeg-static and system PATH."
  );
}

function runFFmpeg(
  ffmpegPath: string,
  args: string[]
) {
  return new Promise<void>(
    (resolve, reject) => {
      const child = spawn(
        ffmpegPath,
        args,
        {
          windowsHide: true,
        }
      );

      let stderr = "";

      child.stderr.on(
        "data",
        (data) => {
          stderr +=
            data.toString();
        }
      );

      child.on(
        "error",
        reject
      );

      child.on(
        "close",
        (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(
                stderr ||
                  `FFmpeg exited with code ${code}`
              )
            );
          }
        }
      );
    }
  );
}

function getVideoDuration(
  ffmpegPath: string,
  filePath: string
) {
  return new Promise<number>(
    (resolve, reject) => {
      const child = spawn(
        ffmpegPath,
        [
          "-i",
          filePath,
          "-f",
          "null",
          "-",
        ],
        {
          windowsHide: true,
        }
      );

      let stderr = "";

      child.stderr.on(
        "data",
        (data) => {
          stderr +=
            data.toString();
        }
      );

      child.on(
        "error",
        reject
      );

      child.on(
        "close",
        () => {
          const match =
            stderr.match(
              /Duration:\s*(\d+):(\d+):([\d.]+)/
            );

          if (!match) {
            resolve(5);
            return;
          }

          const hours =
            Number(match[1]);

          const minutes =
            Number(match[2]);

          const seconds =
            Number(match[3]);

          resolve(
            hours * 3600 +
              minutes * 60 +
              seconds
          );
        }
      );
    }
  );
}

async function extractFrame(
  ffmpegPath: string,
  videoPath: string,
  framePath: string,
  timestamp: number
) {
  await runFFmpeg(
    ffmpegPath,
    [
      "-y",

      "-ss",
      String(timestamp),

      "-i",
      videoPath,

      "-frames:v",
      "1",

      "-vf",
      "scale=768:-1",

      "-q:v",
      "4",

      framePath,
    ]
  );
}

function imageToDataUrl(
  buffer: Buffer
) {
  return (
    "data:image/jpeg;base64," +
    buffer.toString("base64")
  );
}

function cleanJson(
  text: string
) {
  let cleaned =
    text.trim();

  if (
    cleaned.startsWith(
      "```"
    )
  ) {
    cleaned =
      cleaned
        .replace(
          /^```json\s*/i,
          ""
        )
        .replace(
          /^```\s*/i,
          ""
        )
        .replace(
          /\s*```$/,
          ""
        );
  }

  return cleaned.trim();
}

function fallbackAnalysis(
  clip: number,
  filename: string,
  duration: number
): Analysis {
  return {
    clip,
    filename,
    duration,
    score: 50,
    verdict: "review",
    shot_type: "main",
    reason:
      "ATLAS could not parse the AI response.",
    strengths: [],
    problems: [
      "AI response could not be parsed.",
    ],
    recommended_use:
      "Review manually.",
    suggested_start: 0,
    suggested_end:
      Math.min(
        duration,
        5
      ),
  };
}

export async function POST(
  request: Request
) {
  const tempDir =
    path.join(
      os.tmpdir(),
      `atlas-vision-${crypto.randomUUID()}`
    );

  try {
    if (
      !process.env.OPENAI_API_KEY
    ) {
      return NextResponse.json(
        {
          error:
            "OPENAI_API_KEY is missing.",
        },
        {
          status: 500,
        }
      );
    }

    const ffmpegPath =
      await findFFmpeg();

    await fs.mkdir(
      tempDir,
      {
        recursive: true,
      }
    );

    const formData =
      await request.formData();

    const files =
      formData
        .getAll("clips")
        .filter(
          (
            value
          ): value is File =>
            value instanceof File
        );

    if (!files.length) {
      return NextResponse.json(
        {
          error:
            "No video clips were uploaded.",
        },
        {
          status: 400,
        }
      );
    }

    console.log(
      "ATLAS VISION analyzing",
      files.length,
      "clips"
    );

    const analyses: Analysis[] =
      [];

    for (
      let i = 0;
      i < files.length;
      i++
    ) {
      const file =
        files[i];

      console.log(
        `ATLAS VISION clip ${i + 1}/${files.length}`
      );

      const safeName =
        file.name.replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );

      const videoPath =
        path.join(
          tempDir,
          `${i + 1}-${safeName}`
        );

      const buffer =
        Buffer.from(
          await file.arrayBuffer()
        );

      await fs.writeFile(
        videoPath,
        buffer
      );

      const duration =
        await getVideoDuration(
          ffmpegPath,
          videoPath
        );

      console.log(
        "Duration:",
        duration
      );

      /*
       * Three representative moments:
       *
       * 20%
       * 50%
       * 80%
       */

      const timestamps = [
        Math.max(
          0.1,
          duration * 0.2
        ),

        Math.max(
          0.1,
          duration * 0.5
        ),

        Math.max(
          0.1,
          duration * 0.8
        ),
      ];

      const imageInputs: {
        type: "input_image";
        image_url: string;
        detail: "low";
      }[] = [];

      for (
        let j = 0;
        j < timestamps.length;
        j++
      ) {
        const framePath =
          path.join(
            tempDir,
            `clip-${i}-frame-${j}.jpg`
          );

        try {
          await extractFrame(
            ffmpegPath,
            videoPath,
            framePath,
            timestamps[j]
          );

          const frameBuffer =
            await fs.readFile(
              framePath
            );

          imageInputs.push({
            type:
              "input_image",

            image_url:
              imageToDataUrl(
                frameBuffer
              ),

            detail: "low",
          });
        } catch (frameError) {
          console.error(
            "Frame extraction failed:",
            frameError
          );
        }
      }

      if (
        !imageInputs.length
      ) {
        analyses.push(
          fallbackAnalysis(
            i + 1,
            file.name,
            duration
          )
        );

        continue;
      }

      console.log(
        "ATLAS sending frames to OpenAI..."
      );

      const response =
        await openai.responses.create(
          {
            model:
              "gpt-5-mini",

            store: false,

            input: [
              {
                role: "system",

                content: [
                  {
                    type:
                      "input_text",

                    text: `
You are ATLAS, an expert AI commercial video director.

You are analyzing representative frames from ONE raw smartphone video clip.

The goal is to decide how useful this footage is for a short-form social media advertisement for a real local business.

Analyze:

- subject visibility
- product visibility
- framing
- composition
- lighting
- sharpness
- camera stability
- visual appeal
- authenticity
- hook potential
- commercial usefulness
- social media potential

Important:
This is real business footage.
Do NOT judge it like a cinematic movie.
Natural smartphone footage can score highly if it feels authentic and commercially useful.

Return ONLY valid JSON.

Use exactly this structure:

{
  "score": 0,
  "verdict": "excellent",
  "shot_type": "hook",
  "reason": "short explanation",
  "strengths": [
    "strength"
  ],
  "problems": [
    "problem"
  ],
  "recommended_use": "how ATLAS should use this clip",
  "suggested_start": 0,
  "suggested_end": 3
}

Rules:

score:
0-100.

verdict:
"excellent"
"good"
"review"
"reject"

shot_type:
"hook"
"hero"
"detail"
"process"
"lifestyle"
"cta"
"reject"

suggested_start and suggested_end:
must be seconds inside the original clip.

Be honest.
Do not give high scores simply because the image looks attractive.
Think like a social media creative director deciding whether to actually put this footage into a paid advertisement.
`,
                  },
                ],
              },

              {
                role: "user",

                content: [
                  {
                    type:
                      "input_text",

                    text: `
Analyze clip ${i + 1}.

Filename:
${file.name}

Approximate duration:
${duration.toFixed(
  2
)} seconds.

The following three images are representative frames taken from approximately 20%, 50% and 80% of the clip.

Determine the commercial quality and best use of this footage.
`,
                  },

                  ...imageInputs,
                ],
              },
            ],
          }
        );

      const raw =
        response.output_text;

      console.log(
        "ATLAS AI RESPONSE:",
        raw
      );

      try {
        const parsed =
          JSON.parse(
            cleanJson(raw)
          );

        analyses.push({
          clip: i + 1,
          filename:
            file.name,
          duration:
            Number(
              duration.toFixed(
                2
              )
            ),
          score:
            Math.max(
              0,
              Math.min(
                100,
                Number(
                  parsed.score
                ) || 0
              )
            ),
          verdict:
            parsed.verdict ||
            "review",
          shot_type:
            parsed.shot_type ||
            "main",
          reason:
            parsed.reason ||
            "AI analysis completed.",
          strengths:
            Array.isArray(
              parsed.strengths
            )
              ? parsed.strengths
              : [],
          problems:
            Array.isArray(
              parsed.problems
            )
              ? parsed.problems
              : [],
          recommended_use:
            parsed.recommended_use ||
            "Review manually.",
          suggested_start:
            Number(
              parsed.suggested_start
            ) || 0,
          suggested_end:
            Number(
              parsed.suggested_end
            ) ||
            Math.min(
              duration,
              5
            ),
        });
      } catch {
        analyses.push(
          fallbackAnalysis(
            i + 1,
            file.name,
            duration
          )
        );
      }
    }

    /*
     * Best clips first.
     */

    analyses.sort(
      (a, b) =>
        b.score -
        a.score
    );

    console.log(
      "================================"
    );

    console.log(
      "ATLAS VISION SUCCESS"
    );

    console.log(
      analyses
    );

    console.log(
      "================================"
    );

    return NextResponse.json({
      success: true,

      mode: "openai-vision",

      message:
        "ATLAS AI footage analysis completed.",

      clips: analyses,
    });
  } catch (error) {
    console.error(
      "================================"
    );

    console.error(
      "ATLAS VISION ERROR"
    );

    console.error(
      error
    );

    console.error(
      "================================"
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "ATLAS Vision analysis failed.",
      },
      {
        status: 500,
      }
    );
  } finally {
    await fs
      .rm(
        tempDir,
        {
          recursive: true,
          force: true,
        }
      )
      .catch(
        () => {}
      );
  }
}