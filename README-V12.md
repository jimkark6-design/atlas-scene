# ATLAS V12 — Render/Review Flow Fix

## Root cause fixed
The browser was downloading the entire rendered MP4 from `/api/render-output` immediately after a successful render. The server logged `GET /api/render-output 200`, but the browser could still fail while consuming that multi-megabyte body, so `selfOptimizeRenderedCut()` never reached `/api/review-render`.

## V12 behavior
- `/api/render` returns JSON only: `reviewId` + metadata.
- The browser does NOT fetch/download the MP4 during the render/review flow.
- The preview points directly to `/api/render-output?reviewId=...` so the `<video>` element streams it when needed.
- `/api/review-render` reads the server-side cached MP4, extracts frames with FFmpeg, and sends frames to Vision.
- The review cache is kept alive for the TTL instead of being deleted immediately after review, so the preview remains playable.

## Restart
```powershell
Ctrl+C
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm install
npm run dev
```

## Expected log
```text
POST /api/render 200
ATLAS REVIEW CACHE CREATED: <uuid>
[ATLAS V12] RENDER READY — reviewId=<uuid>
ATLAS SERVER-SIDE RENDER REVIEW V9
Review id: <uuid>
ATLAS REVIEW EXTRACTED ... frames
ATLAS REVIEW SENDING ... frames to OpenAI Vision...
ATLAS REVIEW AI RETURNED SCORE XX/100 PASS
```
Or, when revision is needed:
```text
ATLAS REVIEW AI RETURNED SCORE 84/100 REVISE
[ATLAS V8] SELF-CORRECTION PASS 1
POST /api/render 200
...
ATLAS REVIEW AI RETURNED SCORE 94/100 PASS
```
