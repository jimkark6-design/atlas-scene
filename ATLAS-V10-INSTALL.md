# ATLAS V10 — FULL FIXED PROJECT

This is the full source project with the server-side render-review loop integrated.

## What was fixed

- `/api/render` now creates a server-side review token after every successful render.
- The browser no longer uploads the rendered MP4 back to `/api/review-render`.
- `/api/review-render` receives only the review token, extracts frames server-side with FFmpeg, and sends those frames to Vision.
- Self-correction can re-render up to two passes.
- Master-plan duration is fitted to the target duration.
- The production-plan legacy route syntax issue is repaired.
- The render-review cache is temporary and automatically expires.

## Install

Replace your current `atlas-scene` folder with this project source, but KEEP your own `.env.local` with your OpenAI key.

Then in PowerShell:

```powershell
npm install
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

Open:

```text
http://localhost:3000/reel
```

## Expected terminal after render

```text
POST /api/render 200
ATLAS REVIEW CACHE CREATED: <uuid>
POST /api/review-render 200
ATLAS SERVER-SIDE RENDER REVIEW V9
ATLAS REVIEW EXTRACTED ... frames
ATLAS REVIEW SENDING ... frames to OpenAI Vision...
ATLAS REVIEW AI RETURNED SCORE XX/100 PASS
```

If it returns REVISE:

```text
ATLAS REVIEW AI RETURNED SCORE 8X/100 REVISE
ATLAS V8 SELF-CORRECTION PASS 1
POST /api/render 200
ATLAS REVIEW CACHE CREATED: <uuid>
...
ATLAS REVIEW AI RETURNED SCORE 9X/100 PASS
```

Do NOT copy an old `route.tsx` into `app/api/review-render`. The folder must contain only `route.ts`.
