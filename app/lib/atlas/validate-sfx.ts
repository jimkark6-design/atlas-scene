export type AtlasSfxValidationEvent = {
  shotId: string;
  at: number;
  duration: number;
  volume: number;
  type?: string;
  source?: string;
  source_path?: string;
  prompt?: string;
  reason?: string;
};

export type AtlasSfxValidationShot = {
  id: string;
  start: number;
  end: number;
  speed?: number;
  sfx_events?: AtlasSfxValidationEvent[];
};

export type AtlasSfxValidationResult = {
  events: number;
  shotsWithSfx: number;
  durationSeconds: number;
};

const EPSILON = 0.001;
const MIN_EVENT_GAP = 0.2;
const MIN_DURATION = 0.15;
const MAX_DURATION = 1.8;
const MIN_VOLUME = 0.04;
const MAX_VOLUME = 0.28;
const MAX_EVENTS = 8;

const finite = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const renderedShotDuration = (shot: AtlasSfxValidationShot) => {
  const sourceDuration = Math.max(0.25, shot.end - shot.start);
  const speed = Math.max(0.25, Math.min(3, finite(shot.speed) ?? 1));
  return sourceDuration / speed;
};

/**
 * Authoritative pre-render safety boundary for the audio layer.
 * It validates the SFX contract but never invents or rewrites creative intent.
 */
export function validateSfxPlanForRender(
  shots: AtlasSfxValidationShot[],
): AtlasSfxValidationResult {
  if (!Array.isArray(shots) || !shots.length) {
    throw new Error("SFX validation requires an executable timeline.");
  }

  const events: Array<{
    shotIndex: number;
    globalAt: number;
    shotId: string;
    at: number;
    duration: number;
  }> = [];

  let timelineCursor = 0;
  let shotsWithSfx = 0;

  shots.forEach((shot, shotIndex) => {
    const shotId = String(shot?.id || `beat-${shotIndex + 1}`);
    const duration = renderedShotDuration(shot);
    const rawEvents = Array.isArray(shot?.sfx_events) ? shot.sfx_events : [];

    if (rawEvents.length > 1) {
      throw new Error(`SFX validation: more than one SFX event on shot ${shotId}.`);
    }

    if (rawEvents.length) shotsWithSfx += 1;

    rawEvents.forEach((event, eventIndex) => {
      const at = finite(event?.at);
      const eventDuration = finite(event?.duration);
      const volume = finite(event?.volume);
      const type = String(event?.type || "").trim();

      if (at === null || at < -EPSILON || at > duration + EPSILON) {
        throw new Error(`SFX validation: invalid timing on ${shotId} event ${eventIndex + 1}.`);
      }

      if (eventDuration === null || eventDuration < MIN_DURATION || eventDuration > MAX_DURATION) {
        throw new Error(`SFX validation: invalid duration on ${shotId} event ${eventIndex + 1}.`);
      }

      if (at + eventDuration > duration + 0.12) {
        throw new Error(`SFX validation: event overruns shot ${shotId}.`);
      }

      if (volume === null || volume < MIN_VOLUME || volume > MAX_VOLUME) {
        throw new Error(`SFX validation: invalid volume on ${shotId} event ${eventIndex + 1}.`);
      }

      if (!type) {
        throw new Error(`SFX validation: missing event type on ${shotId}.`);
      }

      const isGenerated = type === "AI_GENERATED";
      if (isGenerated) {
        if (!String(event?.source_path || event?.source || "").trim()) {
          throw new Error(`SFX validation: generated event ${shotId} has no audio source.`);
        }
        if (!String(event?.prompt || "").trim()) {
          throw new Error(`SFX validation: generated event ${shotId} has no generation prompt.`);
        }
      }

      events.push({
        shotIndex,
        globalAt: timelineCursor + Math.max(0, at),
        shotId,
        at: Math.max(0, at),
        duration: eventDuration,
      });
    });

    timelineCursor += duration;
  });

  events.sort((a, b) => a.globalAt - b.globalAt);

  for (let i = 1; i < events.length; i += 1) {
    const previous = events[i - 1];
    const current = events[i];
    if (current.globalAt - previous.globalAt < MIN_EVENT_GAP - EPSILON) {
      throw new Error(
        `SFX validation: events are too close (${previous.shotId} → ${current.shotId}).`,
      );
    }
  }

  if (events.length > MAX_EVENTS) {
    throw new Error(`SFX validation: ${events.length} events exceeds maximum ${MAX_EVENTS}.`);
  }

  return {
    events: events.length,
    shotsWithSfx,
    durationSeconds: timelineCursor,
  };
}
