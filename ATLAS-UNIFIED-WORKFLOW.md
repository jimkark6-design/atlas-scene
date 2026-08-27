# ATLAS Unified Workflow

The `/create` and `/reel` experiences are now one workflow.

- `/create` redirects to `/reel`.
- Step 01 contains the Creative Brief and footage upload.
- The Creative Brief is persisted locally and sent to the Master Director with vision and speech intelligence.
- The Master Director is the source of truth for story, shots, speech, captions, transitions, visual treatment and audio direction.
- Existing preview/music/caption/export steps remain after the AI edit.

## Local setup

1. Copy your existing `.env.local` into the project root. Do not commit it.
2. Run `npm install`.
3. If `ffmpeg-static` cannot download its binary, use the already-working `ffmpeg.exe` from your existing ATLAS install as previously configured.
4. Run `npm run dev`.

## Validation

`npx tsc --noEmit` passes on the packaged source tree.
