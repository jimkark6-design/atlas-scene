export type SfxTimelineEvent = {
  shotId: string;
  shotStart: number;
  shotEnd: number;
  at: number;
  duration: number;
};

/**
 * Convert a shot-local SFX event into absolute timeline seconds.
 * SFX Director timing is local to each shot; cross-shot validation must not
 * compare local `at` values directly.
 */
export function toAbsoluteSfxEvent(event: SfxTimelineEvent) {
  return {
    ...event,
    start: event.shotStart + event.at,
    end: event.shotStart + event.at + event.duration,
  };
}

/**
 * Deterministic cross-shot overlap policy for SFX.
 * Intentional layering is allowed only when the events overlap by <= 80ms;
 * otherwise the render plan is rejected so the sound designer can resolve it.
 */
export function findSfxTimelineConflicts(events: SfxTimelineEvent[]) {
  const absolute = events
    .map(toAbsoluteSfxEvent)
    .sort((a, b) => a.start - b.start);

  const conflicts: Array<{ first: typeof absolute[number]; second: typeof absolute[number] }> = [];

  for (let i = 1; i < absolute.length; i++) {
    const previous = absolute[i - 1];
    const current = absolute[i];
    const overlap = previous.end - current.start;

    if (overlap > 0.08) {
      conflicts.push({ first: previous, second: current });
    }
  }

  return conflicts;
}
