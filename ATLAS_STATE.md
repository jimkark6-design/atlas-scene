# ATLAS STATE

> Source of truth for the current ATLAS project state.
> Updated from the GitHub repository, not from assumptions.

## Current Position

- Branch for engineering-OS setup: `chore/engineering-os`
- Operating documents added: roadmap, decisions, tasks, working protocol, changelog.
- Main product architecture remains Director → Edit Director → Render → Review.
- Current product priority: sound intelligence/execution followed by a reliable review → revision loop.

## Baseline Architecture

The unified workflow combines `/create` and `/reel`. `/create` redirects to `/reel`; Creative Brief and footage upload happen in Step 01. The brief is persisted locally and sent to the Master Director with vision and speech intelligence.

Core stages:
1. Analyze / footage analysis
2. Match footage
3. Master Director / master plan
4. Edit Director / executable edit plan
5. SFX Director
6. Remotion render
7. Render review
8. Run logging

Core modules include:
- `app/lib/atlas/atlas-edit-contract.ts`
- `app/lib/atlas/atlas-run-logger.ts`
- `app/lib/atlas/atlas-validate-edit-plan.ts`
- `app/lib/atlas/remotion-engine.ts`
- `app/lib/atlas/render-review-cache.ts`
- `app/lib/atlas/sfx-director.ts`

## Execution Invariants

- Directors make editorial decisions; renderer executes the supplied plan.
- Executable edit data is a validated contract.
- Do not remove validation or run logging to make a task pass.
- A successful render is not proof of editorial quality.
- Review remains a separate stage.
- Do not change the executable contract casually.

## Latest Known End-to-End Run

Run ID: `e51cb452-7aed-47b6-87df-b1d46f2cece6` on 2026-08-26.

- analysis: 6 clips
- footage matching: 5 matches
- master plan: 7 shots
- edit director: 8 beats, 7 SFX events, 8 text beats
- validation: PASS, 8 beats / 6 files
- Remotion execution: 8 beats, 7 SFX events
- render completed successfully
- review completed: score 68

## Latest Review Findings

- CTA held too long in the back half
- repeated ending frames/text
- weak commercial finish
- process/story mismatch in one section
- insufficient visual variety near the ending
- oversized/heavy CTA typography
- brand cue appearing mainly at the end

## Current Next Step

Use the engineering operating system to execute:

`inspect → plan → change → validate → render/review → record result → commit`

First product task: inspect the existing SFX/audio implementation and define the next sound-system improvement without breaking current execution behavior.

## Operating Documents

- `ATLAS_ROADMAP.md` — product direction and phases
- `ATLAS_DECISIONS.md` — architectural decisions and invariants
- `ATLAS_TASKS.md` — current actionable work
- `ATLAS_WORKING_PROTOCOL.md` — human + AI collaboration protocol
- `ATLAS_CHANGELOG.md` — meaningful project changes
