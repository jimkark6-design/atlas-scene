# ATLAS STATE

> Source of truth for the current ATLAS project state.
> Updated from the GitHub repository, not from assumptions.

## Baseline

- Branch: `main`
- Baseline commit: `a8995f8` — `Initial ATLAS project snapshot`
- Repository working tree was clean before this state layer was added.
- Project: Next.js application with Remotion rendering.

## Current Architecture Observed

The documented unified workflow combines `/create` and `/reel`. `/create` redirects to `/reel`; the Creative Brief and footage upload happen in Step 01; the brief is persisted locally and sent to the Master Director with vision and speech intelligence. The documented intent is for the Master Director to be the source of truth for story, shots, speech, captions, transitions, visual treatment and audio direction. Preview/music/caption/export remain after the AI edit.

Core API stages present in the repository:

1. Analyze / footage analysis
2. Match footage
3. Master Director / master plan
4. Edit Director / executable edit plan
5. SFX Director
6. Remotion render
7. Render review
8. Run logging

Core ATLAS library modules present:

- `app/lib/atlas/atlas-edit-contract.ts`
- `app/lib/atlas/atlas-run-logger.ts`
- `app/lib/atlas/atlas-validate-edit-plan.ts`
- `app/lib/atlas/remotion-engine.ts`
- `app/lib/atlas/render-review-cache.ts`
- `app/lib/atlas/sfx-director.ts`

## Editing Contract / Execution Rules Observed

The executable beat contract contains source windows, editorial roles, purpose/cut reasoning, transitions, motion/zoom/speed, text/captions, SFX events, source/music levels and curves, color treatment, crop focus and editorial score.

Executable timeline validation currently enforces, among other things:

- at least 5 beats
- every source filename must exist in the analyzed sources
- valid positive source windows
- minimum beat duration of 0.25s
- no duplicate source windows
- speed curve with at least 2 points
- music curve with at least 2 points
- SFX event array
- final executable beat must be `CTA`

The separate edit-plan validator checks source existence, beat order, source ranges, zoom bounds, duplicate windows, duration drift and voice/script consistency.

## Audio / Remotion Execution Observed

The Remotion engine executes the supplied shots rather than inventing an edit. It builds SFX from explicit `sfx_events`, maps semantic SFX types to project audio assets, supports voice/music, music ducking and voice priority, and renders 1080x1920 H.264/AAC output at 30fps with CRF 18.

The repository contains project music and SFX assets under `public/music` and `public/sfx`.

## Run Logging

ATLAS writes per-run JSONL and human-readable logs under `.atlas/runs/YYYY-MM-DD/`. Run records contain run ID, timestamp, stage, event, level and optional data. Run summaries are also supported.

## Latest Observed End-to-End Run

Run ID: `e51cb452-7aed-47b6-87df-b1d46f2cece6` on 2026-08-26.

Observed pipeline:

- analysis: 6 clips
- footage matching: 5 matches
- master plan: 7 shots
- edit director: 8 beats, 7 SFX events, 8 text beats
- validation: PASS, 8 beats / 6 files
- Remotion execution: 8 beats, 7 SFX events, speed ramps reported in execution plan
- render completed successfully: 15,003,880 bytes
- review completed: score 68

## Latest Review Findings

The latest review reported a strong opening and premium visuals, but identified:

- CTA held too long in the back half
- repeated ending frames/text
- weak commercial finish
- process-story/message mismatch in one section
- insufficient visual variety near the ending
- oversized/heavy CTA typography
- brand cue appearing mainly at the end

These findings are the latest known quality feedback and should be considered before changing the edit architecture.

## Important Project Invariants

- Do not replace the Director → Edit Director → Render separation with renderer improvisation.
- Do not silently remove validation or run logging.
- Do not change the executable edit contract casually; downstream rendering depends on it.
- Do not treat a successful render as proof of editorial quality; Review remains a separate stage.
- Preserve working behavior before introducing architectural changes.

## Known State Gaps

This document is an initial repository-derived state snapshot. It is not yet a complete architectural specification. Before major changes, inspect the relevant route and library files and update this document when behavior changes.

## Next Priority

Build a reliable change-control loop around this state:

`inspect → plan → change → validate → render/review → record result → commit`

Every meaningful ATLAS change should leave the repository and this state/log in agreement.
