# ATLAS Cleanup Backlog

## Purpose
Canonical backlog for the architecture cleanup identified during the ATLAS audit.

## Priority fixes

- [ ] Remove/retire duplicate legacy render path; keep one canonical renderer.
- [ ] Reduce Edit Director responsibilities; move normalization/repair/validation to explicit boundaries.
- [ ] Establish one canonical edit-contract + validation boundary.
- [ ] Make Remotion a deterministic executor of the canonical plan; no creative improvisation.
- [ ] Upgrade Review beyond frame sampling with execution/timeline telemetry.
- [ ] Replace blunt review threshold/revision behavior with targeted revision tiers.
- [ ] Remove Windows-specific hardcoded FFmpeg paths; use configuration/environment discovery.
- [ ] Audit and quarantine/archive legacy V10/V11/V12/V13/V14/V2 files so canonical code is unambiguous.
- [ ] Replace client-only editorial memory with persistent project memory.
- [ ] Connect Review findings to revision context and persistent memory.
- [ ] Add automated verification around the canonical pipeline before accepting changes.

## Required development loop

Inspect -> Plan -> Change -> Validate -> Render/Review -> Log -> Commit

## Rule
No cleanup item is considered complete until the relevant code is inspected, validated, and—where applicable—confirmed by a real render/review.
