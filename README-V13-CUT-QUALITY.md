# ATLAS V13 — Cut Quality + Safe Self-Editing

This update is specifically for the problem visible in the latest preview: the self-review loop was able to shrink a coherent 15s commercial into a 6.4s montage and then stop without reviewing that last render.

## Changes
- Master Director targets 6 purposeful beats for a ~15s Reel and preserves a 13–15s editorial band.
- Review model is now a surgical critic: max one shot removal per pass, 12.5s minimum for a 15s target, preserve hook/middle/payoff/CTA.
- Review revisions preserve the existing shot skeleton unless a destructive change is clearly justified.
- Up to 3 review passes are allowed. The final output is the highest-scored render that was actually reviewed, never an unreviewed last revision.
- Review revisions can now carry `motion` and `speed`, and the renderer honors them instead of silently ignoring those recommendations.
- Motion is no longer a generic sine-wave preset on every shot; it uses deliberate push/pull/pan/static behavior.
