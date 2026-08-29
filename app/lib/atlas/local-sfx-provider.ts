import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type LocalSfxRequest = {
  prompt: string;
  durationSeconds: number;
  outputDir: string;
  cacheKey?: string;
};

export type LocalSfxResult = {
  sourcePath: string;
  cached: boolean;
  provider: "stable-audio-local";
};

function safeDuration(value: number) {
  return Math.max(0.25, Math.min(1.8, Number(value) || 0.65));
}

function cacheId(request: LocalSfxRequest) {
  return crypto
    .createHash("sha256")
    .update(`${request.cacheKey || ""}\n${request.prompt}\n${safeDuration(request.durationSeconds)}`)
    .digest("hex")
    .slice(0, 24);
}

async function findPython() {
  const configured = process.env.ATLAS_SFX_PYTHON;
  const projectVenvPython = path.join(
    process.cwd(),
    ".stable-audio-3",
    ".venv",
    "Scripts",
    "python.exe",
  );

  const candidates = [configured, projectVenvPython, "python", "py"].filter(Boolean) as string[];

  for (const command of candidates) {
    try {
      await execFileAsync(command, ["--version"], { windowsHide: true });
      return command;
    } catch {}
  }

  throw new Error(
    "ATLAS LOCAL SFX: Python was not found. Install Python 3.10+ or configure ATLAS_SFX_PYTHON.",
  );
}

async function findGeneratorScript() {
  const configured = process.env.ATLAS_SFX_GENERATOR_SCRIPT;
  const candidates = [
    configured,
    path.join(process.cwd(), "scripts", "sfx", "generate.py"),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  throw new Error(
    "ATLAS LOCAL SFX: generator script is missing. Set ATLAS_SFX_GENERATOR_SCRIPT to the Stable Audio local generator.",
  );
}

export async function generateLocalSfx(
  request: LocalSfxRequest,
): Promise<LocalSfxResult> {
  const outputDir = path.resolve(request.outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const id = cacheId(request);
  const outputPath = path.join(outputDir, `${id}.wav`);

  try {
    const stat = await fs.stat(outputPath);
    if (stat.size > 44) {
      return { sourcePath: outputPath, cached: true, provider: "stable-audio-local" };
    }
  } catch {}

  // Prefer the project-local Stable Audio virtualenv. This is critical on
  // Windows because the global Python may have an incompatible torchaudio.
  const python = await findPython();
  const script = await findGeneratorScript();
  const duration = safeDuration(request.durationSeconds);

  const { stderr } = await execFileAsync(
    python,
    [script, "--prompt", request.prompt, "--duration", String(duration), "--output", outputPath],
    {
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    },
  );

  try {
    const stat = await fs.stat(outputPath);
    if (stat.size <= 44) throw new Error("generated file is empty");
  } catch (error) {
    throw new Error(
      `ATLAS LOCAL SFX: generation produced no valid WAV for prompt: ${request.prompt}${stderr ? ` | ${stderr.trim().slice(-800)}` : ""}`,
    );
  }

  return { sourcePath: outputPath, cached: false, provider: "stable-audio-local" };
}
