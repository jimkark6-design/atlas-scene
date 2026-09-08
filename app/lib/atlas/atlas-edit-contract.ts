/*
 * ATLAS EDIT CONTRACT V2
 *
 * Purpose:
 * - Keep the existing renderer-facing contract compatible where possible.
 * - Add explicit editorial decision primitives so the Edit Director can describe
 *   professional edits without hiding them inside free-form prompt text.
 * - Keep normalization non-creative and validation side-effect free.
 */

export const ATLAS_EDIT_PLAN_VERSION = "ATLAS_EDIT_PLAN_V2" as const;

export type AtlasRole = "HOOK" | "STORY" | "PAYOFF" | "CTA";

export type AtlasTransition =
  | "CUT"
  | "DISSOLVE"
  | "FADE"
  | "WHIP"
  | "MATCH"
  | "ZOOM"
  | "PUNCH"
  | "SLIDE_LEFT"
  | "SLIDE_RIGHT"
  | "SLIDE_UP"
  | "SLIDE_DOWN"
  | "FLASH"
  | "NONE";

export type AtlasMotion =
  | "STATIC"
  | "PUSH_IN"
  | "PULL_OUT"
  | "PAN_LEFT"
  | "PAN_RIGHT"
  | "TILT_UP"
  | "TILT_DOWN"
  | "HANDHELD"
  | "DRIFT";

export type AtlasCropFocus =
  | "NONE"
  | "CENTER"
  | "FACE"
  | "PRODUCT"
  | "ACTION"
  | "TOP"
  | "BOTTOM"
  | "LEFT"
  | "RIGHT";

export type AtlasCutOn =
  | "ACTION"
  | "MOTION"
  | "WORD"
  | "MUSIC"
  | "REVEAL"
  | "BREATH"
  | "IMPACT"
  | "BEAT"
  | "NONE";

export type AtlasShotRelationship =
  | "STANDALONE"
  | "ACTION_MATCH"
  | "MOTION_MATCH"
  | "MATCH_CUT"
  | "VISUAL_CALLBACK"
  | "REVEAL"
  | "CONTRAST"
  | "CONTINUATION";

export type AtlasVisualStrategy =
  | "HERO"
  | "DETAIL"
  | "ESTABLISH"
  | "ACTION"
  | "REACTION"
  | "PROOF"
  | "TRANSFORMATION"
  | "LIFESTYLE"
  | "PRODUCT"
  | "CTA";

export type AtlasEditorialStrategy =
  | "HOOK"
  | "SETUP"
  | "PROBLEM"
  | "ACTION"
  | "ESCALATION"
  | "PROOF"
  | "PAYOFF"
  | "CTA"
  | "BREATH"
  | "BRIDGE";

export type AtlasFraming =
  | "WIDE"
  | "MEDIUM"
  | "CLOSE"
  | "EXTREME_CLOSE"
  | "FULL_BODY"
  | "PRODUCT_HERO"
  | "DETAIL";

export type AtlasBeatIntent =
  | "HOOK_IMPACT"
  | "PROBLEM"
  | "ACTION"
  | "PROOF"
  | "ESCALATION"
  | "TRANSFORMATION"
  | "HERO"
  | "CTA"
  | "REACTION"
  | "BRIDGE"
  | "BREATH";

export type AtlasSpeedPoint = {
  /** Normalized local position inside the shot: 0..1. */
  at: number;
  speed: number;
};

export type AtlasMusicPoint = {
  /** Normalized local position inside the shot: 0..1. */
  at: number;
  level: number;
};

export type AtlasSfxEvent = {
  type: string;
  at: number;
  volume: number;
  duration?: number;
};

export type AtlasTextPlan = {
  content: string;
  style: string;
  animation: string;
  position: string;
  emphasisWords: string[];
  /** Optional max visible seconds for timed text choreography. */
  duration?: number;
  /** Optional local entry point inside the shot. */
  startAt?: number;
  /** Optional local exit point inside the shot. */
  endAt?: number;
};

export type AtlasMotionPlan = {
  type: AtlasMotion;
  zoomStart: number;
  zoomEnd: number;
  cropFocus: AtlasCropFocus;
  /** Optional normalized focal anchor for dynamic reframing. */
  anchorX?: number;
  anchorY?: number;
};

export type AtlasReframePlan = {
  enabled: boolean;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  smoothing?: number;
};

export type AtlasVisualPlan = {
  strategy?: AtlasVisualStrategy;
  framing?: AtlasFraming;
  colorTreatment: string;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  reframe?: AtlasReframePlan;
};

export type AtlasHoldPlan = {
  enabled: boolean;
  duration: number;
  at: number;
  reason: "EMPHASIS" | "REVEAL" | "CTA" | "COMEDIC" | "BREATH" | "NONE";
};

export type AtlasTimingPlan = {
  sourceStart: number;
  sourceEnd: number;
  cutOn: AtlasCutOn;
  /** Optional micro-cut marker inside the source window. */
  microCut?: boolean;
};

export type AtlasAudioPlan = {
  sourceAudioVolume: number;
  musicVolume: number;
  musicCurve: AtlasMusicPoint[];
  sfx: string[];
  sfxEvents: AtlasSfxEvent[];
  /** Optional voice ducking for music under dialogue/TTS. */
  voiceDuck?: {
    enabled: boolean;
    amount: number;
  };
};

export type AtlasDecisionMeta = {
  /** 0..1 confidence that this is the right editorial choice. */
  confidence: number;
  /** Whether Review/V2 should preserve this shot unless strictly necessary. */
  locked?: boolean;
  /** IDs of plausible alternatives considered by the decision engine. */
  alternativeShotIds?: string[];
  /** Human-readable decision rationale for telemetry/debugging. */
  rationale?: string;
};

export type AtlasShot = {
  id: string;
  sourceFilename: string;

  role: AtlasRole;
  beatIntent: AtlasBeatIntent;

  purpose: string;
  cutReason: string;
  editorialScore: number;

  timing: AtlasTimingPlan;

  transitionIn: AtlasTransition;
  transitionOut: AtlasTransition;

  motion: AtlasMotionPlan;

  /** Base playback speed. Keep for renderer compatibility. */
  speed: number;
  speedCurve: AtlasSpeedPoint[];

  visual: AtlasVisualPlan;

  /** Optional richer editorial relationship to the previous shot. */
  relationship?: AtlasShotRelationship;
  relationshipTo?: string;
  editorialStrategy?: AtlasEditorialStrategy;

  /** Optional explicit moment inside the source clip. */
  sourceMoment?: {
    type: string;
    start: number;
    end: number;
    score?: number;
  };

  /** Optional hold/freeze instruction. */
  hold?: AtlasHoldPlan;

  text?: AtlasTextPlan;
  audio: AtlasAudioPlan;
  decision?: AtlasDecisionMeta;
};

export type AtlasMusicPlan = {
  enabled: boolean;
  volume: number;
  curve: AtlasMusicPoint[];
  /** Optional high-level musical beat grid in seconds. */
  beatGrid?: number[];
};

export type AtlasVoicePlan = {
  mode: string;
  script: string;
  priority: "HIGH" | "NORMAL" | "LOW";
  /** Optional word timing when transcription/TTS timings exist. */
  wordTimings?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
};

export type AtlasCaptionPlan = {
  enabled: boolean;
  mode: string;
  style: string;
  emphasisWords: string[];
};

export type AtlasCoverPlan = {
  enabled: boolean;
  shotId?: string;
  title?: string;
  subtitle?: string;
};
export type AtlasQualityPlan = {
  targetDurationSeconds: number;
  minimumBeats: number;
  maximumBeats: number;
  requireCta: boolean;

  /** Editorial quality guards. */
  maxNonCutTransitions?: number;
  maxTextBeats?: number;
  maxAdjacentSameSource?: number;

  /** Per-role pacing limits in seconds. */
  roleDurationLimits?: {
    HOOK: { min: number; max: number };
    STORY: { min: number; max: number };
    PAYOFF: { min: number; max: number };
    CTA: { min: number; max: number };
  };
};

export type AtlasCreativePlan = {
  objective: string;
  audience: string;
  tone: string;
  platform: string;
  aspectRatio: string;
  retentionStrategy: string;
};

export type AtlasEditPlanV2 = {
  version: typeof ATLAS_EDIT_PLAN_VERSION;

  creative: AtlasCreativePlan;

  timeline: {
    shots: AtlasShot[];
  };

  music: AtlasMusicPlan;
  voice: AtlasVoicePlan;
  captions: AtlasCaptionPlan;
  cover: AtlasCoverPlan;
  quality: AtlasQualityPlan;
};

/** Backward-compatible alias for code that still uses the old name. */
export type AtlasEditPlanV1 = AtlasEditPlanV2;

export type AtlasSourceAsset = {
  filename: string;
  duration: number;
};

export type AtlasValidationSeverity = "error" | "warning";

export type AtlasValidationIssue = {
  severity: AtlasValidationSeverity;
  code: string;
  message: string;
  shotId?: string;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

function normalizeFiniteNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Creates a neutral speed curve when the Edit Director does not provide one.
 * This is normalization only and does not make a creative decision.
 */
export function normalizeSpeedCurve(
  curve: unknown,
  baseSpeed: number,
): AtlasSpeedPoint[] {
  if (Array.isArray(curve) && curve.length >= 2) {
    const points = curve
      .map((point: any) => ({
        at: normalizeFiniteNumber(point?.at, NaN),
        speed: normalizeFiniteNumber(point?.speed, NaN),
      }))
      .filter(
        (point) => Number.isFinite(point.at) && Number.isFinite(point.speed),
      )
      .map((point) => ({
        at: clamp(point.at, 0, 1),
        speed: clamp(point.speed, 0.25, 3),
      }))
      .sort((a, b) => a.at - b.at);

    if (points.length >= 2) return points;
  }

  const speed = clamp(normalizeFiniteNumber(baseSpeed, 1), 0.25, 3);
  return [
    { at: 0, speed },
    { at: 1, speed },
  ];
}

/**
 * Creates a neutral music curve when no explicit curve exists.
 * This is normalization only and does not invent musical changes.
 */
export function normalizeMusicCurve(
  curve: unknown,
  baseLevel: number,
): AtlasMusicPoint[] {
  if (Array.isArray(curve) && curve.length >= 2) {
    const points = curve
      .map((point: any) => ({
        at: normalizeFiniteNumber(point?.at, NaN),
        level: normalizeFiniteNumber(point?.level, NaN),
      }))
      .filter(
        (point) => Number.isFinite(point.at) && Number.isFinite(point.level),
      )
      .map((point) => ({
        at: clamp(point.at, 0, 1),
        level: clamp(point.level, 0, 1),
      }))
      .sort((a, b) => a.at - b.at);

    if (points.length >= 2) return points;
  }

  const level = clamp(normalizeFiniteNumber(baseLevel, 0), 0, 1);
  return [
    { at: 0, level },
    { at: 1, level },
  ];
}

/**
 * Converts explicit SFX declarations into executable events.
 * No SFX is invented here.
 */
export function deriveSfxEvents(
  sfx: unknown,
  events: unknown,
  shotDuration: number,
): AtlasSfxEvent[] {
  if (Array.isArray(events)) {
    return events
      .map((event: any) => ({
        type: String(event?.type || "").trim(),
        at: normalizeFiniteNumber(event?.at, NaN),
        volume: normalizeFiniteNumber(event?.volume, NaN),
        duration:
          event?.duration == null
            ? undefined
            : normalizeFiniteNumber(event.duration, NaN),
      }))
      .filter(
        (event) =>
          event.type &&
          Number.isFinite(event.at) &&
          Number.isFinite(event.volume),
      )
      .map((event) => ({
        ...event,
        at: clamp(event.at, 0, Math.max(0, shotDuration)),
        volume: clamp(event.volume, 0, 1),
        ...(event.duration != null && Number.isFinite(event.duration)
          ? {
              duration: clamp(
                event.duration,
                0,
                Math.max(0, shotDuration),
              ),
            }
          : {}),
      }));
  }

  if (Array.isArray(sfx)) {
    return sfx
      .map((value) => String(value).trim())
      .filter(Boolean)
      .map((type) => ({
        type,
        at: 0,
        volume: 0.15,
      }));
  }

  return [];
}

function validateCurvePoints(
  curve: Array<{ at: number; speed?: number; level?: number }>,
  kind: "speed" | "music",
  shotId: string,
  issues: AtlasValidationIssue[],
): void {
  if (curve.length < 2) {
    issues.push({
      severity: "error",
      code: kind === "speed" ? "INVALID_SPEED_CURVE" : "INVALID_MUSIC_CURVE",
      message: `${kind} curve must contain at least two points.`,
      shotId,
    });
    return;
  }

  let previousAt = -Infinity;
  for (const point of curve) {
    if (!Number.isFinite(point.at) || point.at < 0 || point.at > 1) {
      issues.push({
        severity: "error",
        code: kind === "speed" ? "INVALID_SPEED_CURVE" : "INVALID_MUSIC_CURVE",
        message: `${kind} curve position must be within 0..1.`,
        shotId,
      });
      break;
    }

    if (point.at < previousAt) {
      issues.push({
        severity: "error",
        code: kind === "speed" ? "INVALID_SPEED_CURVE" : "INVALID_MUSIC_CURVE",
        message: `${kind} curve points must be ordered by position.`,
        shotId,
      });
      break;
    }

    previousAt = point.at;

    const value = kind === "speed" ? point.speed : point.level;
    const min = kind === "speed" ? 0.25 : 0;
    const max = kind === "speed" ? 3 : 1;
    if (!Number.isFinite(value) || (value as number) < min || (value as number) > max) {
      issues.push({
        severity: "error",
        code: kind === "speed" ? "INVALID_SPEED_CURVE" : "INVALID_MUSIC_CURVE",
        message: `${kind} curve value is out of bounds.`,
        shotId,
      });
      break;
    }
  }
}

/**
 * Strict executable-plan validation.
 * This function MUST NOT mutate the plan.
 */
export function validateExecutableTimeline(
  plan: AtlasEditPlanV2,
  sources: AtlasSourceAsset[],
): AtlasValidationIssue[] {
  const issues: AtlasValidationIssue[] = [];

  if (plan.version !== ATLAS_EDIT_PLAN_VERSION) {
    issues.push({
      severity: "error",
      code: "INVALID_VERSION",
      message: `Expected ${ATLAS_EDIT_PLAN_VERSION}.`,
    });
  }

  const shots = plan.timeline?.shots ?? [];
  const quality = plan.quality;

  if (shots.length < quality.minimumBeats) {
    issues.push({
      severity: "error",
      code: "TOO_FEW_SHOTS",
      message: `Timeline contains ${shots.length} shots; minimum is ${quality.minimumBeats}.`,
    });
  }

  if (shots.length > quality.maximumBeats) {
    issues.push({
      severity: "error",
      code: "TOO_MANY_SHOTS",
      message: `Timeline contains ${shots.length} shots; maximum is ${quality.maximumBeats}.`,
    });
  }

  const sourceMap = new Map(sources.map((source) => [source.filename, source]));
  const seenIds = new Set<string>();
  const seenWindows = new Set<string>();
  const shotIds = new Set(shots.map((shot) => shot.id));
  const nonCutTransitions = shots.filter(
    (shot) => shot.transitionIn !== "CUT" && shot.transitionIn !== "NONE",
  ).length;
  const textBeats = shots.filter((shot) => Boolean(shot.text?.content?.trim())).length;

  if (
    quality.maxNonCutTransitions != null &&
    nonCutTransitions > quality.maxNonCutTransitions
  ) {
    issues.push({
      severity: "warning",
      code: "TOO_MANY_NON_CUT_TRANSITIONS",
      message: `Timeline uses ${nonCutTransitions} non-cut transitions; target is ${quality.maxNonCutTransitions}.`,
    });
  }

  if (quality.maxTextBeats != null && textBeats > quality.maxTextBeats) {
    issues.push({
      severity: "warning",
      code: "TOO_MANY_TEXT_BEATS",
      message: `Timeline uses ${textBeats} text beats; target is ${quality.maxTextBeats}.`,
    });
  }

  for (const shot of shots) {
    if (seenIds.has(shot.id)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_SHOT_ID",
        message: `Shot id is duplicated: ${shot.id}.`,
        shotId: shot.id,
      });
    }
    seenIds.add(shot.id);

    const source = sourceMap.get(shot.sourceFilename);
    if (!source) {
      issues.push({
        severity: "error",
        code: "MISSING_SOURCE",
        message: `Source does not exist: ${shot.sourceFilename}.`,
        shotId: shot.id,
      });
      continue;
    }

    const start = shot.timing.sourceStart;
    const end = shot.timing.sourceEnd;
    const shotDuration = end - start;

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      issues.push({
        severity: "error",
        code: "INVALID_RANGE",
        message: "Shot source range contains a non-finite value.",
        shotId: shot.id,
      });
      continue;
    }

    if (start < 0 || end <= start) {
      issues.push({
        severity: "error",
        code: "INVALID_RANGE",
        message: `Invalid source range ${start}-${end}.`,
        shotId: shot.id,
      });
    }

    if (end > source.duration + 0.05) {
      issues.push({
        severity: "error",
        code: "OUT_OF_RANGE",
        message: `Shot ends at ${end.toFixed(2)}s but source duration is ${source.duration.toFixed(2)}s.`,
        shotId: shot.id,
      });
    }

    if (!Number.isFinite(shot.speed) || shot.speed < 0.25 || shot.speed > 3) {
      issues.push({
        severity: "error",
        code: "INVALID_SPEED",
        message: "Speed must be between 0.25x and 3x.",
        shotId: shot.id,
      });
    }

    if (
      shot.motion.zoomStart < 1 ||
      shot.motion.zoomStart > 1.45 ||
      shot.motion.zoomEnd < 1 ||
      shot.motion.zoomEnd > 1.45
    ) {
      issues.push({
        severity: "error",
        code: "INVALID_ZOOM",
        message: "Zoom must be between 1.0x and 1.45x.",
        shotId: shot.id,
      });
    }

    if (
      shot.motion.anchorX != null &&
      (shot.motion.anchorX < 0 || shot.motion.anchorX > 1)
    ) {
      issues.push({
        severity: "error",
        code: "INVALID_ANCHOR",
        message: "motion.anchorX must be between 0 and 1.",
        shotId: shot.id,
      });
    }

    if (
      shot.motion.anchorY != null &&
      (shot.motion.anchorY < 0 || shot.motion.anchorY > 1)
    ) {
      issues.push({
        severity: "error",
        code: "INVALID_ANCHOR",
        message: "motion.anchorY must be between 0 and 1.",
        shotId: shot.id,
      });
    }

    const windowKey =
      `${shot.sourceFilename}:` +
      `${start.toFixed(3)}:` +
      `${end.toFixed(3)}`;

    if (seenWindows.has(windowKey)) {
      issues.push({
        severity: "error",
        code: "DUPLICATE_WINDOW",
        message: "Exact source window is repeated.",
        shotId: shot.id,
      });
    }
    seenWindows.add(windowKey);

    validateCurvePoints(shot.speedCurve, "speed", shot.id, issues);
    validateCurvePoints(shot.audio.musicCurve, "music", shot.id, issues);

    if (!Array.isArray(shot.audio.sfxEvents)) {
      issues.push({
        severity: "error",
        code: "INVALID_SFX_EVENTS",
        message: "SFX events must be an array.",
        shotId: shot.id,
      });
    } else {
      for (const event of shot.audio.sfxEvents) {
        if (
          !event.type ||
          !Number.isFinite(event.at) ||
          event.at < 0 ||
          event.at > Math.max(0, shotDuration) ||
          !Number.isFinite(event.volume) ||
          event.volume < 0 ||
          event.volume > 1
        ) {
          issues.push({
            severity: "error",
            code: "INVALID_SFX_EVENT",
            message: "SFX event is outside the shot bounds.",
            shotId: shot.id,
          });
          break;
        }
      }
    }

    if (shot.relationshipTo && !shotIds.has(shot.relationshipTo)) {
      issues.push({
        severity: "error",
        code: "INVALID_RELATIONSHIP_TARGET",
        message: `relationshipTo does not exist: ${shot.relationshipTo}.`,
        shotId: shot.id,
      });
    }

    if (shot.relationshipTo === shot.id) {
      issues.push({
        severity: "error",
        code: "SELF_RELATIONSHIP",
        message: "A shot cannot relate to itself.",
        shotId: shot.id,
      });
    }

    if (
      (shot.relationship === "ACTION_MATCH" ||
        shot.relationship === "MOTION_MATCH" ||
        shot.relationship === "MATCH_CUT" ||
        shot.relationship === "VISUAL_CALLBACK") &&
      !shot.relationshipTo
    ) {
      issues.push({
        severity: "warning",
        code: "RELATIONSHIP_TARGET_MISSING",
        message: `${shot.relationship} should identify relationshipTo.`,
        shotId: shot.id,
      });
    }

    if (shot.sourceMoment) {
      if (
        !Number.isFinite(shot.sourceMoment.start) ||
        !Number.isFinite(shot.sourceMoment.end) ||
        shot.sourceMoment.start < 0 ||
        shot.sourceMoment.end <= shot.sourceMoment.start ||
        shot.sourceMoment.end > source.duration + 0.05
      ) {
        issues.push({
          severity: "error",
          code: "INVALID_SOURCE_MOMENT",
          message: "sourceMoment is outside the source bounds.",
          shotId: shot.id,
        });
      }
    }

    if (shot.text) {
      if (shot.text.startAt != null && shot.text.startAt < 0) {
        issues.push({
          severity: "error",
          code: "INVALID_TEXT_TIMING",
          message: "text.startAt cannot be negative.",
          shotId: shot.id,
        });
      }
      if (
        shot.text.endAt != null &&
        shot.text.startAt != null &&
        shot.text.endAt < shot.text.startAt
      ) {
        issues.push({
          severity: "error",
          code: "INVALID_TEXT_TIMING",
          message: "text.endAt cannot be before text.startAt.",
          shotId: shot.id,
        });
      }
      if (
        shot.text.endAt != null &&
        shot.text.endAt > Math.max(0, shotDuration) + 0.05
      ) {
        issues.push({
          severity: "error",
          code: "INVALID_TEXT_TIMING",
          message: "text.endAt exceeds shot duration.",
          shotId: shot.id,
        });
      }
    }

    if (shot.hold?.enabled) {
      if (
        !Number.isFinite(shot.hold.duration) ||
        shot.hold.duration < 0 ||
        shot.hold.duration > Math.max(0, shotDuration)
      ) {
        issues.push({
          severity: "error",
          code: "INVALID_HOLD",
          message: "Hold duration is outside the shot duration.",
          shotId: shot.id,
        });
      }
      if (
        !Number.isFinite(shot.hold.at) ||
        shot.hold.at < 0 ||
        shot.hold.at > Math.max(0, shotDuration)
      ) {
        issues.push({
          severity: "error",
          code: "INVALID_HOLD",
          message: "Hold position is outside the shot duration.",
          shotId: shot.id,
        });
      }
    }

    if (shot.decision) {
      if (
        !Number.isFinite(shot.decision.confidence) ||
        shot.decision.confidence < 0 ||
        shot.decision.confidence > 1
      ) {
        issues.push({
          severity: "error",
          code: "INVALID_DECISION_CONFIDENCE",
          message: "decision.confidence must be between 0 and 1.",
          shotId: shot.id,
        });
      }
    }
  }

  const ctaShots = shots.filter((shot) => shot.role === "CTA");

  if (quality.requireCta) {
    if (ctaShots.length !== 1) {
      issues.push({
        severity: "error",
        code: "CTA_CONTRACT",
        message: `Expected exactly one CTA; found ${ctaShots.length}.`,
      });
    } else if (shots[shots.length - 1]?.id !== ctaShots[0].id) {
      issues.push({
        severity: "error",
        code: "CTA_NOT_FINAL",
        message: "CTA must be the final shot.",
        shotId: ctaShots[0].id,
      });
    }
  }

  const adjacentSameSource = shots.reduce((count, shot, index) => {
    if (index === 0) return 0;
    return count + (shot.sourceFilename === shots[index - 1].sourceFilename ? 1 : 0);
  }, 0);

  if (
    quality.maxAdjacentSameSource != null &&
    adjacentSameSource > quality.maxAdjacentSameSource
  ) {
    issues.push({
      severity: "warning",
      code: "ADJACENT_SAME_SOURCE",
      message: `Timeline contains ${adjacentSameSource} adjacent same-source transitions; target is ${quality.maxAdjacentSameSource}.`,
    });
  }

  return issues;
}

/** Throws when the executable plan is invalid. */
export function assertExecutableTimeline(
  plan: AtlasEditPlanV2,
  sources: AtlasSourceAsset[],
): void {
  const issues = validateExecutableTimeline(plan, sources);
  const errors = issues.filter((issue) => issue.severity === "error");

  if (errors.length > 0) {
    throw new Error(
      `${ATLAS_EDIT_PLAN_VERSION} validation failed:\n` +
        errors
          .map(
            (issue) =>
              `[${issue.code}] ${issue.message}${
                issue.shotId ? ` (${issue.shotId})` : ""
              }`,
          )
          .join("\n"),
    );
  }
}
