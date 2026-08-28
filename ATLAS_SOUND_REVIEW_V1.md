# ATLAS Sound Review V1

## Render reviewed
- Car-detailing commercial
- 8 executable beats
- 13.8s final render
- First post-SFX-validation render

## Findings

### What worked
- SFX execution is now protected by a render-boundary validator.
- Disabled AI SFX metadata no longer blocks rendering.
- The SFX Director has explicit premium-detailing Foley guidance.

### Engineering findings
1. SFX planning is visual-sample driven, but the current director samples only two frames per shot. This is enough for broad action recognition but not reliable for exact contact/transient timing.
2. SFX spacing must be evaluated in global timeline time, not local `at` values from different shots.
3. The SFX Director currently applies a one-event-per-shot limiter even though its prompt permits a second event for a separate major reveal/transition. This should be made an explicit deterministic policy.
4. Generated SFX failures are currently tolerated and omitted from the executable plan. This is correct for resilience, but the run log must make planned/generated/failed counts explicit so review can distinguish "no SFX chosen" from "generation failed".

## Next implementation pass
- Add deterministic global-timeline SFX conflict validation.
- Improve visual sampling around action windows before changing the renderer.
- Preserve intentional silence.
- Log planned/generated/failed SFX counts and prompts as review metadata.

## Review rule
Do not add more SFX just to make the track feel busy. The target is motivated, physical, subtle commercial Foley with intentional silence.
