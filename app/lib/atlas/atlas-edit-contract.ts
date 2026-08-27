export type SpeedPoint = { at: number; speed: number };
export type MusicPoint = { at: number; level: number };
export type SfxEvent = { type: string; at: number; volume: number };

export type AtlasEditBeat = {
  id: string;
  source_filename: string;
  source_start: number;
  source_end: number;
  role: "HOOK" | "STORY" | "PAYOFF" | "CTA";
  purpose: string;
  cut_reason: string;
  transition_in: string;
  transition_out: string;
  motion: string;
  zoom_start: number;
  zoom_end: number;
  speed: number;
  speed_curve: SpeedPoint[];
  text: string;
  text_style: string;
  text_animation: string;
  text_position: string;
  emphasis_words: string[];
  sfx: string[];
  sfx_events: SfxEvent[];
  source_audio_volume: number;
  music_volume: number;
  music_curve: MusicPoint[];
  color_treatment: string;
  crop_focus: string;
  editorial_score: number;
  beat_intent: string;
  cut_on: string;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function normalizeSpeedCurve(value: unknown, fallback = 1): SpeedPoint[] {
  if (!Array.isArray(value) || value.length < 2) {
    return [
      { at: 0, speed: clamp(fallback, 0.5, 2) },
      { at: 1, speed: clamp(fallback, 0.5, 2) },
    ];
  }
  const points = value
    .map((p: any) => ({
      at: clamp(Number(p?.at), 0, 1),
      speed: clamp(Number(p?.speed) || fallback, 0.5, 2),
    }))
    .sort((a, b) => a.at - b.at);
  if (points[0].at !== 0) points.unshift({ at: 0, speed: points[0].speed });
  if (points[points.length - 1].at !== 1) points.push({ at: 1, speed: points[points.length - 1].speed });
  return points.slice(0, 5);
}

export function normalizeMusicCurve(value: unknown, fallback = 0.65): MusicPoint[] {
  if (!Array.isArray(value) || value.length < 2) {
    const level = clamp(fallback, 0, 1);
    return [{ at: 0, level }, { at: 1, level }];
  }
  const points = value
    .map((p: any) => ({ at: clamp(Number(p?.at), 0, 1), level: clamp(Number(p?.level), 0, 1) }))
    .sort((a, b) => a.at - b.at);
  if (points[0].at !== 0) points.unshift({ at: 0, level: points[0].level });
  if (points[points.length - 1].at !== 1) points.push({ at: 1, level: points[points.length - 1].level });
  return points.slice(0, 6);
}

export function deriveSfxEvents(labels: unknown, existing: unknown, duration: number): SfxEvent[] {
  const existingEvents = Array.isArray(existing)
    ? existing.map((e: any) => ({
        type: String(e?.type || "NONE").toUpperCase(),
        at: clamp(Number(e?.at) || 0, 0, Math.max(0, duration - 0.08)),
        volume: clamp(Number(e?.volume) || 0.18, 0, 1),
      }))
    : [];
  if (existingEvents.length) return existingEvents.slice(0, 3);

  const map: Record<string, { type: string; at: number; volume: number }> = {
    WATER: { type: "WATER", at: 0.42, volume: 0.24 },
    SPRAY: { type: "WATER", at: 0.42, volume: 0.24 },
    FOAM: { type: "FOAM", at: 0.45, volume: 0.2 },
    WIPE: { type: "WIPE", at: 0.45, volume: 0.18 },
    BRUSH: { type: "WIPE", at: 0.45, volume: 0.2 },
    SCRUB: { type: "WIPE", at: 0.45, volume: 0.2 },
    MACHINE: { type: "MACHINE", at: 0.35, volume: 0.16 },
    WHOOSH: { type: "WHOOSH", at: 0.18, volume: 0.13 },
    HOOK_IMPACT: { type: "HOOK_IMPACT", at: 0.08, volume: 0.2 },
    REVEAL_IMPACT: { type: "REVEAL_IMPACT", at: 0.2, volume: 0.24 },
    CTA_HIT: { type: "CTA_HIT", at: 0.18, volume: 0.18 },
    CLICK: { type: "CLICK", at: 0.2, volume: 0.14 },
    POP: { type: "POP", at: 0.2, volume: 0.14 },
  };
  return (Array.isArray(labels) ? labels : [])
    .map((x) => map[String(x || "").toUpperCase()])
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => ({ ...x, at: Math.min(x.at, Math.max(0, duration - 0.08)) }));
}

export function validateExecutableTimeline(timeline: any[], analyses: any[]) {
  if (!Array.isArray(timeline) || timeline.length < 5) throw new Error("Executable timeline needs at least 5 beats.");
  const names = new Set(analyses.map((x: any) => String(x.filename)));
  const seenWindows = new Set<string>();
  for (const beat of timeline) {
    const filename = String(beat?.source_filename || "");

    if (!names.has(filename)) {
      throw new Error(`Timeline source missing: ${filename}`);
    }

    const sourceStart = Number(beat?.source_start);
    const sourceEnd = Number(beat?.source_end);

    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd)) {
      throw new Error(
        `Invalid source window: ${filename}|${sourceStart}|${sourceEnd} | beat=${beat?.id || "unknown"}`
      );
    }

    if (sourceStart < 0) {
      throw new Error(
        `Invalid source_start: ${filename}|${sourceStart} | beat=${beat?.id || "unknown"}`
      );
    }

    if (sourceEnd <= sourceStart) {
      throw new Error(
        `Invalid source window: ${filename}|${sourceStart}|${sourceEnd} | beat=${beat?.id || "unknown"}`
      );
    }

    const duration = sourceEnd - sourceStart;
    if (duration < 0.25) throw new Error(`Timeline beat too short: ${beat.id}`);

    const sig = `${filename}|${sourceStart.toFixed(3)}|${sourceEnd.toFixed(3)}`;
    if (seenWindows.has(sig)) {
      throw new Error(`Duplicate source window: ${sig} | beat=${beat?.id || "unknown"}`);
    }
    seenWindows.add(sig);
    if (!Array.isArray(beat.speed_curve) || beat.speed_curve.length < 2) throw new Error(`Missing speed curve: ${beat.id}`);
    if (!Array.isArray(beat.music_curve) || beat.music_curve.length < 2) throw new Error(`Missing music curve: ${beat.id}`);
    if (!Array.isArray(beat.sfx_events)) throw new Error(`Missing SFX event array: ${beat.id}`);
  }
  if (String(timeline[timeline.length - 1].role) !== "CTA") throw new Error("CTA must be the final executable beat.");
  return true;
}
