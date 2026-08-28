# ATLAS local SFX

ATLAS uses OpenAI as the SFX Director and Stable Audio 3 Small SFX for actual sound generation.

Stable Audio 3 Small SFX is a dedicated text-to-SFX model. The official runtime supports `small-sfx` and consumer hardware. The model is gated on Hugging Face, so the operator must accept Stability AI's model terms before the first download.

## One-time setup

1. Install Python 3.10+.
2. Clone the official Stable Audio 3 repository somewhere outside ATLAS:

   `git clone https://github.com/Stability-AI/stable-audio-3.git`

3. In that repository, install the runtime with `uv sync`.
4. Accept access to `stabilityai/stable-audio-3-small-sfx` on Hugging Face.
5. In ATLAS `.env.local`, set:

   `ATLAS_AI_SFX_ENABLED=true`
   `ATLAS_SFX_PYTHON=C:\\path\\to\\stable-audio-3\\.venv\\Scripts\\python.exe`
   `ATLAS_SFX_GENERATOR_SCRIPT=C:\\path\\to\\atlas-scene\\scripts\\sfx\\generate.py`

The generator downloads the model on first use and caches generated SFX by prompt + duration. No SFX API key is required.

## Safety contract

There is intentionally no library/random fallback. If Stable Audio does not produce a valid WAV, the SFX event fails instead of silently inserting a project sound.
