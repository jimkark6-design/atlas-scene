$ErrorActionPreference = 'Stop'

$Repo = Join-Path $PSScriptRoot '..\..'
$Repo = (Resolve-Path $Repo).Path
$StableAudioDir = Join-Path $Repo '.stable-audio-3'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host 'uv is required. Install it from https://docs.astral.sh/uv/ and rerun this script.'
  exit 1
}

if (-not (Test-Path $StableAudioDir)) {
  git clone https://github.com/Stability-AI/stable-audio-3.git $StableAudioDir
}

Push-Location $StableAudioDir
try {
  uv sync
} finally {
  Pop-Location
}

$Python = Join-Path $StableAudioDir '.venv\Scripts\python.exe'
$Generator = Join-Path $Repo 'scripts\sfx\generate.py'

Write-Host ''
Write-Host 'ATLAS local SFX runtime is installed.'
Write-Host ''
Write-Host 'Add these lines to .env.local:'
Write-Host "ATLAS_AI_SFX_ENABLED=true"
Write-Host "ATLAS_LOCAL_SFX_ENABLED=true"
Write-Host "ATLAS_SFX_PYTHON=$Python"
Write-Host "ATLAS_SFX_GENERATOR_SCRIPT=$Generator"
Write-Host ''
Write-Host 'Accept the gated Stable Audio 3 Small SFX model on Hugging Face before the first generation.'
