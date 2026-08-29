import fs from "node:fs";

const file = "app/lib/atlas/sfx-director.ts";
let source = fs.readFileSync(file, "utf8");

const start = source.indexOf("async function generateOne(");
const end = source.indexOf("\nexport async function designAndGenerateSfx(", start);

if (start < 0 || end < 0) {
  throw new Error("Could not locate generateOne() in sfx-director.ts");
}

const replacement = [
  "async function generateOne(",
  "  event: SfxEvent,",
  "  outputDir: string,",
  "): Promise<SfxEvent> {",
  "  const localSfxEnabled = String(process.env.ATLAS_LOCAL_SFX_ENABLED || \"true\").toLowerCase() === \"true\";",
  "",
  "  if (!localSfxEnabled) {",
  "    throw new Error(\"ATLAS LOCAL SFX: ATLAS_LOCAL_SFX_ENABLED=false. No fallback source is permitted.\");",
  "  }",
  "",
  "  const hash = crypto.createHash(\"sha1\").update(event.prompt + \"|\" + event.duration.toFixed(2)).digest(\"hex\").slice(0, 16);",
  "  const outputPath = path.join(outputDir, hash + \".wav\");",
  "",
  "  try {",
  "    await fs.access(outputPath);",
  "    console.log(\"[ATLAS AI SFX] CACHE HIT | \" + event.id);",
  "    return { ...event, source_path: outputPath };",
  "  } catch {}",
  "",
  "  console.log(\"[ATLAS AI SFX] GENERATING LOCAL | \" + event.id + \" | duration=\" + event.duration.toFixed(2));",
  "",
  "  const { generateLocalSfx } = await import(\"./local-sfx-provider\");",
  "  const result = await generateLocalSfx({",
  "    prompt: event.prompt,",
  "    durationSeconds: event.duration,",
  "    outputDir,",
  "    cacheKey: hash,",
  "  });",
  "",
  "  console.log(\"[ATLAS AI SFX] \" + (result.cached ? \"CACHE HIT\" : \"GENERATED LOCAL\") + \" | \" + event.id + \" | \" + result.sourcePath);",
  "",
  "  return { ...event, source_path: result.sourcePath };",
  "}",
  "",
].join("\n");

source = source.slice(0, start) + replacement + source.slice(end);

// Generated audio must survive until Remotion copies it into the render bundle.
// The old implementation stored WAVs inside the temporary SFX-analysis folder,
// which was deleted in the finally block before Remotion consumed source_path.
const tempGeneratedDir = 'const generatedDir = path.join(\n      tempDir,\n      "generated",\n    );';
const persistentGeneratedDir = 'const generatedDir = path.join(\n      process.cwd(),\n      "public",\n      ".atlas-sfx-cache",\n    );';

if (!source.includes(tempGeneratedDir)) {
  throw new Error("Could not locate temporary generatedDir in sfx-director.ts");
}

source = source.replace(
  tempGeneratedDir,
  persistentGeneratedDir,
);

fs.writeFileSync(file, source, "utf8");
console.log("Patched " + file + " to use the local Stable Audio SFX provider and persistent SFX cache.");
