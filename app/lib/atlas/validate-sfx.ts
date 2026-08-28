type SfxEvent = {
  type?: string;
  at?: number;
  duration?: number;
  volume?: number;
  source?: string;
  source_path?: string;
};

type SfxShot = {
  id?: string;
  start?: number;
  end?: number;
  speed?: number;
  sfx_events?: SfxEvent[];
};

const MAX_EVENTS_PER_SHOT = 8;
const MAX_TOTAL_EVENTS = 24;
const MIN_EVENT_DURATION = 0.05;
const MAX_EVENT_DURATION = 8;
const MIN_VOLUME = 0;
const MAX_VOLUME = 1;
const MIN_EVENT_GAP = 0.02;

function finite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function renderedShotDuration(shot: SfxShot): number {
  const sourceDuration = Math.max(
    0.25,
    finite(shot.end, 1) - finite(shot.start, 0),
  );
  const speed = Math.max(0.25, Math.min(3, finite(shot.speed, 1)));
  return sourceDuration / speed;
}

export function validateSfxPlan(shots: SfxShot[]): void {
  if (!Array.isArray(shots) || shots.length === 0) {
    throw new Error("SFX validation failed: no executable shots supplied.");
  }

  let totalEvents = 0;
  let timelineCursor = 0;
  const globalEvents: Array<{ start: number; end: number; shotId: string; type: string }> = [];

  for (const shot of shots) {
    const events = Array.isArray(shot.sfx_events) ? shot.sfx_events : [];
    const shotId = String(shot.id || "unknown-shot");
    const duration = renderedShotDuration(shot);

    if (events.length > MAX_EVENTS_PER_SHOT) {
      throw new Error(
        `SFX validation failed: ${shotId} has ${events.length} events; maximum is ${MAX_EVENTS_PER_SHOT}.`,
      );
    }

    totalEvents += events.length;
    if (totalEvents > MAX_TOTAL_EVENTS) {
      throw new Error(
        `SFX validation failed: timeline has more than ${MAX_TOTAL_EVENTS} SFX events.`,
      );
    }

    for (const event of events) {
      const type = String(event?.type || "").trim();
      const at = finite(event?.at, NaN);
      const eventDuration = finite(event?.duration, 0.8);
      const volume = finite(event?.volume, 0.14);
      const source = String(event?.source || "").trim();
      const sourcePath = String(event?.source_path || "").trim();

      if (!type) {
        throw new Error(`SFX validation failed: ${shotId} contains an event without a type.`);
      }
      if (!Number.isFinite(at) || at < 0 || at >= duration) {
        throw new Error(
          `SFX validation failed: ${shotId}/${type} starts outside the rendered shot duration.`,
        );
      }
      if (!Number.isFinite(eventDuration) || eventDuration < MIN_EVENT_DURATION || eventDuration > MAX_EVENT_DURATION) {
        throw new Error(
          `SFX validation failed: ${shotId}/${type} has invalid duration ${eventDuration}.`,
        );
      }
      if (!Number.isFinite(volume) || volume < MIN_VOLUME || volume > MAX_VOLUME) {
        throw new Error(
          `SFX validation failed: ${shotId}/${type} has invalid volume ${volume}.`,
        );
      }
      if (!source && !sourcePath) {
        throw new Error(
          `SFX validation failed: ${shotId}/${type} has no audio source or source_path.`,
        );
      }

      const start = timelineCursor + at;
      const end = start + eventDuration;
      globalEvents.push({ start, end, shotId, type });
    }

    timelineCursor += duration;
  }

  globalEvents.sort((a, b) => a.start - b.start);

  for (let i = 1; i < globalEvents.length; i += 1) {
    const previous = globalEvents[i - 1];
    const current = globalEvents[i];

    if (current.start < previous.end - MIN_EVENT_GAP) {
      throw new Error(
        `SFX validation failed: overlapping events ${previous.shotId}/${previous.type} and ${current.shotId}/${current.type}.`,
      );
    }
  }
}
