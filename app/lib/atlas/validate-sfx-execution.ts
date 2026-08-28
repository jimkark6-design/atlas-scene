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
const FALLBACK_SFX_TYPES = /whoosh|whip|swipe|push|pull|move|transition|sweep|water|wash|spray|pressure|foam|splash|rinse|wipe|brush|scrub|cloth|microfiber|clean|rub|click|button|snap|tap|tick|pop|sparkle|shine|reveal|chime|impact|hit|punch|accent|slam|thump/i;

function finite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function renderedShotDuration(shot: SfxShot): number {
  const sourceDuration = Math.max(0.25, finite(shot.end, 1) - finite(shot.start, 0));
  const speed = Math.max(0.25, Math.min(3, finite(shot.speed, 1)));
  return sourceDuration / speed;
}

export function validateSfxExecutionPlan(shots: SfxShot[]): void {
  if (!Array.isArray(shots) || shots.length === 0) {
    throw new Error("SFX validation failed: no executable shots supplied.");
  }

  let totalEvents = 0;

  for (const shot of shots) {
    const events = Array.isArray(shot.sfx_events) ? shot.sfx_events : [];
    const shotId = String(shot.id || "unknown-shot");
    const duration = renderedShotDuration(shot);

    if (events.length > MAX_EVENTS_PER_SHOT) {
      throw new Error(`SFX validation failed: ${shotId} has ${events.length} events; maximum is ${MAX_EVENTS_PER_SHOT}.`);
    }

    totalEvents += events.length;
    if (totalEvents > MAX_TOTAL_EVENTS) {
      throw new Error(`SFX validation failed: timeline has more than ${MAX_TOTAL_EVENTS} SFX events.`);
    }

    for (const event of events) {
      const type = String(event?.type || "").trim();
      const at = finite(event?.at, NaN);
      const eventDuration = finite(event?.duration, 0.8);
      const volume = finite(event?.volume, 0.14);
      const source = String(event?.source || "").trim();
      const sourcePath = String(event?.source_path || "").trim();

      if (!type) throw new Error(`SFX validation failed: ${shotId} contains an event without a type.`);
      if (!Number.isFinite(at) || at < 0 || at >= duration) {
        throw new Error(`SFX validation failed: ${shotId}/${type} starts outside the rendered shot duration.`);
      }
      if (!Number.isFinite(eventDuration) || eventDuration < MIN_EVENT_DURATION || eventDuration > MAX_EVENT_DURATION) {
        throw new Error(`SFX validation failed: ${shotId}/${type} has invalid duration ${eventDuration}.`);
      }
      if (!Number.isFinite(volume) || volume < 0 || volume > 1) {
        throw new Error(`SFX validation failed: ${shotId}/${type} has invalid volume ${volume}.`);
      }
      if (!source && !sourcePath && !FALLBACK_SFX_TYPES.test(type)) {
        throw new Error(`SFX validation failed: ${shotId}/${type} has no generated source and no deterministic fallback.`);
      }
    }
  }
}
