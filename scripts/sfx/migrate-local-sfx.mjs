import fs from "node:fs";

const file = "app/lib/atlas/sfx-director.ts";
let source = fs.readFileSync(file, "utf8");

source = source.replace(
  'const elevenKey = process.env.ELEVENLABS_API_KEY;\n',
  'const localSfxEnabled = String(process.env.ATLAS_LOCAL_SFX_ENABLED || "true").toLowerCase() === "true";\n',
);

const start = source.indexOf("async function generateOne(");
const end = source.indexOf("\nexport async function designAndGenerateSfx(", start);
if (start < 0 || end < 0) throw new Error("Could not locate generateOne() in sfx-director.ts");

const replacement = `async function generateOne(\n  event: SfxEvent,\n  outputDir: string,\n): Promise<SfxEvent> {\n  if (!localSfxEnabled) {\n    throw new Error(\n      "ATLAS LOCAL SFX: ATLAS_LOCAL_SFX_ENABLED=false. No fallback source is permitted.",\n    );\n  }\n\n  const hash = crypto\n    .createHash("sha1")\n    .update(\
      \\`${"${event.prompt}"}|${"${event.duration.toFixed(2)}"}\`,\n    )\n    .digest("hex")\n    .slice(0, 16);\n\n  const outputPath = path.join(outputDir, \\`${"${hash}"}.wav\\`);\n\n  try {\n    await fs.access(outputPath);\n    console.log(\\`[ATLAS AI SFX] CACHE HIT | ${"${event.id}"}\\`);\n    return { ...event, source_path: outputPath };\n  } catch {}\n\n  console.log(\n    \\`[ATLAS AI SFX] GENERATING LOCAL | ${"${event.id}"} | duration=${"${event.duration.toFixed(2)}"}\\`,\n  );\n\n  const { generateLocalSfx } = await import("./local-sfx-provider");\n  const result = await generateLocalSfx({\n    prompt: event.prompt,\n    durationSeconds: event.duration,\n    outputDir,\n    cacheKey: hash,\n  });\n\n  console.log(\n    \\`[ATLAS AI SFX] ${"${result.cached ? "CACHE HIT" : "GENERATED LOCAL}"} | ${"${event.id}"} | ${"${result.sourcePath}"}\\`,\n  );\n\n  return { ...event, source_path: result.sourcePath };\n}\n`;

source = source.slice(0, start) + replacement + source.slice(end);
source = source.replace(
  /\n  if \(!elevenKey\) \{\n    throw new Error\(\n      \"ATLAS SFX DIRECTOR: ELEVENLABS_API_KEY is missing\\. Add it to \.env\.local\.\",\n    \);\n  \}\n/,
  "\n",
);

fs.writeFileSync(file, source, "utf8");
console.log(`Patched ${file} to use the local Stable Audio SFX provider.`);
