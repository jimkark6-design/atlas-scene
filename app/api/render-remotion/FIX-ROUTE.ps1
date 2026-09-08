$ErrorActionPreference = 'Stop'

$route = Join-Path (Get-Location) 'app\api\render-remotion\route.ts'
if (-not (Test-Path -LiteralPath $route)) {
  throw "Δεν βρέθηκε το app\api\render-remotion\route.ts. Τρέξε το script από το root του atlas-scene."
}

$text = Get-Content -LiteralPath $route -Raw -Encoding UTF8

# Remove obsolete renderer-side normalization helpers.
$start = $text.IndexOf('function cleanRole(')
$end = $text.IndexOf('export async function POST', $start)
if ($start -ge 0 -and $end -gt $start) {
  $text = $text.Substring(0, $start) + $text.Substring($end)
}

# Replace fake source duration with real analyzed durations from clipAnalyses.
$oldPattern = '(?s)const canonicalPlan = normalizeAtlasEditPlan\(\s*\{\s*timeline: filteredTimeline,\s*\},\s*files\.map\(\(file\) => \(\{\s*filename: file\.name,\s*duration: 999999,\s*\}\)\),\s*\);'
$newBlock = @'
const clipAnalysesRaw = formData.get("clipAnalyses");

let clipAnalyses: Array<{
  filename: string;
  duration: number;
}> = [];

if (typeof clipAnalysesRaw === "string") {
  try {
    const parsed = JSON.parse(clipAnalysesRaw);

    if (Array.isArray(parsed)) {
      clipAnalyses = parsed
        .map((item: any) => ({
          filename: String(item?.filename || ""),
          duration: Number(item?.duration || 0),
        }))
        .filter(
          (item) =>
            item.filename &&
            Number.isFinite(item.duration) &&
            item.duration > 0,
        );
    }
  } catch {
    clipAnalyses = [];
  }
}

const durationByFilename = new Map(
  clipAnalyses.map((item) => [item.filename, item.duration]),
);

const sourceAssets = files.map((file) => {
  const duration = durationByFilename.get(file.name);

  if (!duration) {
    throw new Error(
      `Missing real analyzed duration for source: ${file.name}`,
    );
  }

  return {
    filename: file.name,
    duration,
  };
});

const canonicalPlan = normalizeAtlasEditPlan(
  {
    timeline: filteredTimeline,
  },
  sourceAssets,
);
'@
$text = [regex]::Replace($text, $oldPattern, $newBlock, 1)

# Validator needs source assets with duration too.
$validatorPattern = '(?s)validateExecutableTimeline\(\s*canonicalPlan,\s*files\.map\(\(file\) => \(\{\s*filename: file\.name,\s*\}\)\),\s*\);'
$validatorReplacement = @'
validateExecutableTimeline(
  canonicalPlan,
  sourceAssets,
);
'@
$text = [regex]::Replace($text, $validatorPattern, $validatorReplacement, 1)

# Adapter exposes music_volume, not music_intensity.
$text = $text.Replace(
  'Number(shot.music_intensity || 0.12)',
  'Number(shot.music_volume || 0.12)'
)

Set-Content -LiteralPath $route -Value $text -Encoding UTF8

Write-Host "OK: route.ts διορθώθηκε." -ForegroundColor Green
Write-Host "Τώρα τρέξε: npx tsc --noEmit" -ForegroundColor Cyan
