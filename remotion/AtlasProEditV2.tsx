import React from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type SpeedPoint = { at?: number; speed?: number };

type Shot = {
  id: string;
  role?: string;
  source_filename: string;
  start: number;
  end: number;
  speed?: number;
  speed_curve?: SpeedPoint[];
  zoom_start?: number;
  zoom_end?: number;
  motion?: string;
  transition_in?: string;
  transition_out?: string;
  transition_duration?: number;
  transition_direction?: string;
  crop?: string;
  source_audio_volume?: number;
  on_screen_text?: string;
  text_position?: string;
  text_style?: string;
  text_animation?: string;
  text_size?: number;
  text_color?: string;
  text_weight?: number;
  emphasis_words?: string[];
  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  x?: number;
  y?: number;
  rotation?: number;
  color_treatment?: string;
  beat_intent?: string;
};

type Sfx = {
  source?: string;
  start?: number;
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
};

type Props = {
  shots: Shot[];
  assets: Record<string, string>;
  voice?: string;
  music?: string;
  musicVolume?: number;
  musicDucking?: boolean;
  musicDuckingDb?: number;
  sfx?: Sfx[];
  fps: number;
  width: number;
  height: number;
};

const clamp = (n: number, a: number, b: number) =>
  Math.max(a, Math.min(b, n));

const normalize = (value?: string) =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

const curve = (
  points: SpeedPoint[] | undefined,
  progress: number,
  fallback: number
) => {
  if (!Array.isArray(points) || points.length < 2) return fallback;

  const values = points
    .map((point) => ({
      at: clamp(Number(point?.at) || 0, 0, 1),
      speed: clamp(Number(point?.speed) || fallback, 0.5, 3),
    }))
    .sort((a, b) => a.at - b.at);

  if (progress <= values[0].at) return values[0].speed;

  for (let i = 1; i < values.length; i++) {
    if (progress <= values[i].at) {
      const a = values[i - 1];
      const b = values[i];
      const t = (progress - a.at) / Math.max(0.0001, b.at - a.at);
      return a.speed + (b.speed - a.speed) * t;
    }
  }

  return values[values.length - 1].speed;
};

const cropPosition = (crop?: string) => {
  const value = normalize(crop);

  const positions: Record<string, string> = {
    FACE: "50% 38%",
    PRODUCT: "50% 52%",
    ACTION: "50% 55%",
    TOP: "50% 30%",
    BOTTOM: "50% 70%",
    LEFT: "30% 50%",
    RIGHT: "70% 50%",
    TOP_LEFT: "30% 30%",
    TOP_RIGHT: "70% 30%",
    BOTTOM_LEFT: "30% 70%",
    BOTTOM_RIGHT: "70% 70%",
    CENTER: "50% 50%",
  };

  return positions[value] || "50% 50%";
};

const transitionName = (value?: string) => {
  const raw = normalize(value);

  const aliases: Record<string, string> = {
    FADE_IN: "FADE",
    FADE_OUT: "FADE",
    CROSS_FADE: "DISSOLVE",
    CROSSFADE: "DISSOLVE",
    WHIP_PAN: "WHIP",
    MATCH_CUT: "MATCH",
    MATCHCUT: "MATCH",
    NONE: "CUT",
  };

  return aliases[raw] || raw || "CUT";
};

const transitionFramesFor = (
  name: string,
  duration: number,
  fps: number,
  requestedSeconds?: number
) => {
  if (name === "CUT") return 0;

  const seconds = Math.max(
    0.01,
    Number(requestedSeconds) || 0.18
  );

  return Math.min(
    Math.max(1, Math.round(seconds * fps)),
    Math.max(1, Math.floor(duration * 0.45))
  );
};

const textPosition = (position?: string) => {
  const p = normalize(position);

  if (p.includes("TOP")) return { top: 135, bottom: "auto" as const };
  if (p.includes("MIDDLE") || p.includes("CENTER")) {
    return { top: "50%", bottom: "auto" as const };
  }

  return { bottom: 185, top: "auto" as const };
};

const colorTreatment = (value?: string) => {
  const treatment = normalize(value);

  if (treatment === "WARM_PREMIUM" || treatment === "WARM") {
    return "brightness(1.02) contrast(1.08) saturate(1.08) sepia(0.035)";
  }

  if (treatment === "COOL_CLEAN" || treatment === "COOL") {
    return "brightness(1.02) contrast(1.06) saturate(1.02) hue-rotate(-3deg)";
  }

  if (treatment === "HIGH_CONTRAST" || treatment === "PUNCHY") {
    return "brightness(1.01) contrast(1.14) saturate(1.08)";
  }

  if (treatment === "SOFT") {
    return "brightness(1.025) contrast(1.02) saturate(0.98)";
  }

  return "";
};

const TextLayer = ({
  shot,
  duration,
}: {
  shot: Shot;
  duration: number;
}) => {
  const frame = useCurrentFrame();
  const text = String(shot.on_screen_text || "").trim();

  if (!text) return null;

  const edge = Math.min(12, Math.max(5, Math.round(duration * 0.10)));
  const enter = clamp(frame / edge, 0, 1);
  const exit = clamp((duration - 1 - frame) / edge, 0, 1);
  const easeIn = enter * enter * (3 - 2 * enter);
  const easeOut = exit * exit * (3 - 2 * exit);

  const animation = normalize(shot.text_animation);
  let translateY = 0;
  let translateX = 0;
  let scale = 1;

  if (animation.includes("UP") || animation === "SLIDE_UP") {
    translateY = interpolate(easeIn, [0, 1], [34, 0]);
  } else if (animation.includes("DOWN") || animation === "SLIDE_DOWN") {
    translateY = interpolate(easeIn, [0, 1], [-34, 0]);
  } else if (animation.includes("LEFT")) {
    translateX = interpolate(easeIn, [0, 1], [-34, 0]);
  } else if (animation.includes("RIGHT")) {
    translateX = interpolate(easeIn, [0, 1], [34, 0]);
  } else if (animation.includes("POP") || animation.includes("SCALE")) {
    scale = interpolate(easeIn, [0, 1], [0.88, 1]);
  }

  const role = normalize(shot.role);
  const style = normalize(shot.text_style);

  const isHook = role === "HOOK";
  const isCta = role === "CTA";
  const isPremium = style.includes("PREMIUM") || isHook || isCta;

  const fontSize =
    Number(shot.text_size) ||
    (isCta ? 72 : isHook ? 86 : 70);

  const fontWeight =
    Number(shot.text_weight) ||
    (isPremium ? 850 : 750);

  const emphasis = new Set(
    Array.isArray(shot.emphasis_words)
      ? shot.emphasis_words.map((word) => word.trim().toLowerCase()).filter(Boolean)
      : []
  );

  const words = text.split(/(\s+)/);

  return (
    <div
      style={{
        position: "absolute",
        left: isCta ? 110 : 60,
        right: isCta ? 110 : 60,
        ...textPosition(shot.text_position),
        opacity: easeIn * easeOut,
        transform: `translate(${translateX}px, ${translateY}px) scale(${scale})`,
        transformOrigin: "center",
        fontSize,
        fontWeight,
        color: shot.text_color || "white",
        fontFamily: "Arial, Helvetica, sans-serif",
        lineHeight: isCta ? 1.10 : 1.02,
        whiteSpace: "pre-line",
        textAlign: "center",
        letterSpacing: isPremium ? -1.4 : -0.8,
        textShadow: "0 5px 20px rgba(0,0,0,.50)",
      }}
    >
      {words.map((word, index) => {
        const clean = word.trim().toLowerCase();
        const emphasized = clean && emphasis.has(clean);

        return (
          <React.Fragment key={`${word}-${index}`}>
            {emphasized ? (
              <span style={{ fontWeight: 900 }}>{word}</span>
            ) : (
              word
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

const ShotLayer = ({
  shot,
  src,
  duration,
  index,
  transitionInFrames,
  transitionOutFrames,
  sourceStartFrame,
}: {
  shot: Shot;
  src: string;
  duration: number;
  index: number;
  transitionInFrames: number;
  transitionOutFrames: number;
  sourceStartFrame: number;
  sourceFrameCount: number;
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = clamp(frame / Math.max(1, duration - 1), 0, 1);
  const speed = curve(
    shot.speed_curve,
    progress,
    clamp(Number(shot.speed) || 1, 0.5, 3)
  );

  const transitionIn = transitionName(shot.transition_in);
  const transitionOut = transitionName(shot.transition_out);
  const transitionDirection = normalize(shot.transition_direction) || "RIGHT";

  // Transition animation MUST use the exact overlap window used by the
  // timeline. Using a percentage of the shot duration here can keep the
  // incoming clip off-canvas after the outgoing clip has already ended,
  // exposing the black root background.
  const enterProgress = transitionInFrames > 0
    ? clamp(
        frame / Math.max(1, transitionInFrames - 1),
        0,
        1
      )
    : 1;
  const exitProgress = transitionOutFrames > 0
    ? clamp(
        (duration - 1 - frame) / Math.max(1, transitionOutFrames - 1),
        0,
        1
      )
    : 1;

  const enterEase = enterProgress * enterProgress * (3 - 2 * enterProgress);
  const exitEase = exitProgress * exitProgress * (3 - 2 * exitProgress);

  let opacity = 1;
  let transitionX = 0;
  let transitionY = 0;
  let transitionScale = 1;
  let transitionBlur = 0;

  // Explicit transition execution only.
  if (
    transitionIn === "DISSOLVE" ||
    transitionIn === "FADE" ||
    transitionIn === "CROSSFADE"
  ) {
    opacity = enterEase;
  }

  if (
    transitionOut === "DISSOLVE" ||
    transitionOut === "FADE" ||
    transitionOut === "CROSSFADE"
  ) {
    opacity *= exitEase;
  }

  if (transitionIn === "SLIDE_LEFT") {
    transitionX = interpolate(enterEase, [0, 1], [-100, 0]);
  } else if (transitionIn === "SLIDE_RIGHT") {
    transitionX = interpolate(enterEase, [0, 1], [100, 0]);
  } else if (transitionIn === "SLIDE_UP") {
    transitionY = interpolate(enterEase, [0, 1], [100, 0]);
  } else if (transitionIn === "SLIDE_DOWN") {
    transitionY = interpolate(enterEase, [0, 1], [-100, 0]);
  } else if (transitionIn === "ZOOM" || transitionIn === "PUNCH") {
    transitionScale = interpolate(
      enterEase,
      [0, 0.65, 1],
      transitionIn === "PUNCH" ? [1.16, 1.035, 1] : [1.10, 1.018, 1]
    );
  } else if (transitionIn === "WHIP") {
    const fromRight = transitionDirection === "RIGHT";
    transitionX = interpolate(
      enterEase,
      [0, 1],
      [fromRight ? 100 : -100, 0]
    );
    transitionBlur = interpolate(enterEase, [0, 1], [9, 0]);
    transitionScale = interpolate(enterEase, [0, 1], [1.08, 1.02]);
  } else if (transitionIn === "MATCH") {
    transitionScale = interpolate(enterEase, [0, 0.7, 1], [1.075, 1.018, 1]);
    transitionBlur = interpolate(enterEase, [0, 0.65, 1], [6, 1.5, 0]);
    opacity = enterEase;
  } else if (transitionIn === "FLASH") {
    opacity = 1;
  } else if (transitionIn === "BLUR") {
    transitionBlur = interpolate(enterEase, [0, 0.55, 1], [18, 3, 0]);
    transitionScale = interpolate(enterEase, [0, 1], [1.045, 1]);
  } else if (transitionIn === "ROTATE") {
    motionRotation += interpolate(enterEase, [0, 0.72, 1], [5.5, 1.0, 0]);
    transitionScale = interpolate(enterEase, [0, 1], [1.035, 1]);
  } else if (transitionIn === "GLITCH") {
    const glitch = 1 - enterEase;
    transitionX = Math.sin(frame * 2.7 + index * 11) * 2.2 * glitch;
    transitionY = Math.cos(frame * 3.4 + index * 7) * 0.9 * glitch;
    transitionBlur = 1.5 * glitch;
    transitionScale = interpolate(enterEase, [0, 1], [1.025, 1]);
  } else if (transitionIn === "SWIRL") {
    motionRotation += interpolate(enterEase, [0, 0.7, 1], [-7, -1.5, 0]);
    transitionScale = interpolate(enterEase, [0, 0.7, 1], [1.08, 1.018, 1]);
    transitionBlur = interpolate(enterEase, [0, 0.65, 1], [7, 1.5, 0]);
  } else if (transitionIn === "LIGHT_LEAK") {
    opacity = enterEase;
  }

  if (transitionOut === "WHIP") {
    const exitsLeft = transitionDirection === "RIGHT";
    transitionX = interpolate(
      1 - exitEase,
      [0, 1],
      [0, exitsLeft ? -100 : 100]
    );
    transitionBlur = Math.max(
      transitionBlur,
      interpolate(1 - exitEase, [0, 1], [0, 8])
    );
    transitionScale = Math.max(transitionScale, interpolate(1 - exitEase, [0, 1], [1.02, 1.08]));
  } else if (transitionOut === "ZOOM") {
    transitionScale *= interpolate(1 - exitEase, [0, 1], [1, 1.08]);
    transitionBlur = Math.max(transitionBlur, interpolate(1 - exitEase, [0, 1], [0, 2]));
  } else if (transitionOut === "PUNCH") {
    transitionScale *= interpolate(1 - exitEase, [0, 0.65, 1], [1, 1.025, 1.08]);
  } else if (transitionOut === "MATCH") {
    transitionScale *= interpolate(1 - exitEase, [0, 1], [1, 1.045]);
    transitionBlur = Math.max(transitionBlur, interpolate(1 - exitEase, [0, 1], [0, 4]));
  } else if (transitionOut === "BLUR") {
    transitionBlur = Math.max(transitionBlur, interpolate(1 - exitEase, [0, 0.55, 1], [0, 3, 16]));
    transitionScale *= interpolate(1 - exitEase, [0, 1], [1, 1.035]);
  } else if (transitionOut === "ROTATE") {
    motionRotation += interpolate(1 - exitEase, [0, 0.72, 1], [0, 1.0, 5.5]);
  } else if (transitionOut === "GLITCH") {
    const glitch = 1 - exitEase;
    transitionX += Math.sin(frame * 2.7 + index * 11) * 2.2 * glitch;
    transitionY += Math.cos(frame * 3.4 + index * 7) * 0.9 * glitch;
    transitionBlur = Math.max(transitionBlur, 1.5 * glitch);
  } else if (transitionOut === "SWIRL") {
    motionRotation += interpolate(1 - exitEase, [0, 0.7, 1], [0, -1.5, -7]);
    transitionScale *= interpolate(1 - exitEase, [0, 0.7, 1], [1, 1.018, 1.08]);
    transitionBlur = Math.max(transitionBlur, interpolate(1 - exitEase, [0, 0.65, 1], [0, 1.5, 7]));
  } else if (transitionOut === "LIGHT_LEAK") {
    opacity *= interpolate(exitEase, [0, 1], [0.82, 1]);
  }

  // Director-controlled camera motion.
  const motion = normalize(shot.motion);

  let motionX = 0;
  let motionY = 0;
  let motionScale = 1;
  let motionRotation = Number(shot.rotation) || 0;

  if (motion === "PAN_LEFT") {
    motionX = interpolate(progress, [0, 1], [2.2, -2.2]);
  } else if (motion === "PAN_RIGHT") {
    motionX = interpolate(progress, [0, 1], [-2.2, 2.2]);
  } else if (motion === "TILT_UP") {
    motionY = interpolate(progress, [0, 1], [1.8, -1.8]);
  } else if (motion === "TILT_DOWN") {
    motionY = interpolate(progress, [0, 1], [-1.8, 1.8]);
  } else if (motion === "PUSH_IN") {
    motionScale = interpolate(progress, [0, 1], [1, 1.055]);
  } else if (motion === "PUSH_OUT" || motion === "PULL_OUT") {
    motionScale = interpolate(progress, [0, 1], [1.055, 1]);
  } else if (motion === "DRIFT") {
    motionX = interpolate(progress, [0, 1], [-1.25, 1.25]);
    motionY = interpolate(progress, [0, 1], [0.65, -0.65]);
  } else if (motion === "HANDHELD") {
    motionX = Math.sin(frame * 0.19 + index * 17) * 0.45;
    motionY = Math.cos(frame * 0.23 + index * 17) * 0.32;
    motionRotation += Math.sin(frame * 0.11 + index) * 0.16;
  }

  const directorZoom = interpolate(
    progress,
    [0, 1],
    [
      Number(shot.zoom_start) || 1,
      Number(shot.zoom_end) || 1.04,
    ]
  );

  const brightness = Number.isFinite(Number(shot.brightness))
    ? Number(shot.brightness)
    : 1.02;
  const contrast = Number.isFinite(Number(shot.contrast))
    ? Number(shot.contrast)
    : 1.08;
  const saturation = Number.isFinite(Number(shot.saturation))
    ? Number(shot.saturation)
    : 1.04;
  const blur = Number(shot.blur) || 0;

  const treatment = colorTreatment(shot.color_treatment);

  const filters = [
    `brightness(${brightness})`,
    `contrast(${contrast})`,
    `saturate(${saturation})`,
    treatment,
    transitionBlur ? `blur(${transitionBlur}px)` : "",
    blur ? `blur(${blur}px)` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const totalScale =
    directorZoom * motionScale * transitionScale;

  return (
    <AbsoluteFill
      style={{
        opacity,
        overflow: "hidden",
        transform: `translate(${transitionX + motionX + Number(shot.x || 0)}%, ${
          transitionY + motionY + Number(shot.y || 0)
        }%) rotate(${motionRotation}deg) scale(${totalScale})`,
        transformOrigin: cropPosition(shot.crop),
        filter: filters,
      }}
    >
      <OffthreadVideo
        src={staticFile(src)}
        startFrom={sourceStartFrame}
        playbackRate={speed}
        muted={Number(shot.source_audio_volume || 0) <= 0}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: cropPosition(shot.crop),
        }}
      />

      {transitionIn === "FLASH" && (
        <AbsoluteFill
          style={{
            backgroundColor: "white",
            opacity: interpolate(enterEase, [0, 0.18, 1], [0.92, 0.42, 0]),
            pointerEvents: "none",
          }}
        />
      )}
      {transitionOut === "FLASH" && (
        <AbsoluteFill
          style={{
            backgroundColor: "white",
            opacity: interpolate(exitEase, [1, 0.55, 0], [0, 0.35, 0.9]),
            pointerEvents: "none",
          }}
        />
      )}
      {transitionIn === "LIGHT_LEAK" && (
        <AbsoluteFill
          style={{
            background: "linear-gradient(115deg, rgba(255,255,255,0.82) 0%, rgba(255,215,150,0.42) 28%, rgba(255,255,255,0) 62%)",
            opacity: interpolate(enterEase, [0, 0.35, 1], [0.9, 0.5, 0]),
            mixBlendMode: "screen",
            pointerEvents: "none",
          }}
        />
      )}
      {transitionOut === "LIGHT_LEAK" && (
        <AbsoluteFill
          style={{
            background: "linear-gradient(115deg, rgba(255,255,255,0) 0%, rgba(255,215,150,0.42) 42%, rgba(255,255,255,0.82) 100%)",
            opacity: interpolate(exitEase, [1, 0.55, 0], [0, 0.5, 0.9]),
            mixBlendMode: "screen",
            pointerEvents: "none",
          }}
        />
      )}
      {transitionIn === "GLITCH" && (
        <AbsoluteFill
          style={{
            opacity: interpolate(enterEase, [0, 0.35, 1], [0.72, 0.18, 0]),
            background: "linear-gradient(90deg, rgba(255,0,90,0.16), transparent 42%, rgba(0,220,255,0.16))",
            mixBlendMode: "screen",
            pointerEvents: "none",
          }}
        />
      )}
      {transitionOut === "GLITCH" && (
        <AbsoluteFill
          style={{
            opacity: interpolate(exitEase, [1, 0.45, 0], [0, 0.18, 0.72]),
            background: "linear-gradient(90deg, rgba(255,0,90,0.16), transparent 42%, rgba(0,220,255,0.16))",
            mixBlendMode: "screen",
            pointerEvents: "none",
          }}
        />
      )}
      <TextLayer shot={shot} duration={duration} />
    </AbsoluteFill>
  );
};

export const AtlasProEditV2: React.FC<Props> = ({
  shots,
  assets,
  voice,
  music,
  musicVolume = 0.12,
  musicDucking = true,
  musicDuckingDb = 8,
  sfx = [],
}) => {
  const { fps } = useVideoConfig();

  let cursor = 0;

  return (
    <AbsoluteFill style={{ background: "black" }}>
      {shots.map((shot, index) => {
        const transitionIn = transitionName(shot.transition_in);
        const transitionOut = transitionName(shot.transition_out);

        const baseSpeed = clamp(Number(shot.speed) || 1, 0.5, 3);

        const duration = Math.max(
          8,
          Math.round(
            ((Number(shot.end) - Number(shot.start)) / baseSpeed) * fps
          )
        );

        const nextShot = shots[index + 1];
        const outgoingTransition = nextShot
          ? transitionName(nextShot.transition_in || shot.transition_out)
          : transitionOut;
        const outgoingTransitionDuration = nextShot?.transition_duration
          ?? shot.transition_duration;

        // The incoming shot owns the transition window between two shots.
        // Use the exact same number of frames for timeline overlap and visual
        // animation so there can never be a gap between the two layers.
        // EXECUTION FIDELITY V1:
        // Creative transition effects (WHIP/ZOOM/PUNCH/MATCH/etc.) are
        // executed as cut-bound entry/exit animations, not as timeline
        // overlaps. This keeps the approved editorial duration and shot
        // boundaries intact while preserving the existing visual effects.
        // Only true compositing transitions are allowed to consume timeline
        // overlap because they require both shots to be visible together.
        const compositedTransition =
          outgoingTransition === "DISSOLVE" ||
          outgoingTransition === "FADE" ||
          outgoingTransition === "CROSSFADE";

        const overlap = nextShot && compositedTransition
          ? transitionFramesFor(
              outgoingTransition,
              duration,
              fps,
              outgoingTransitionDuration
            )
          : 0;

        const transitionInFrames = transitionFramesFor(
          transitionIn,
          duration,
          fps,
          shot.transition_duration
        );

        const transitionOutFrames = overlap;

        // `cursor` already points to the start of the incoming overlap because
        // the previous shot advanced by (duration - overlap). Do NOT subtract
        // overlap a second time; doing so creates a 2x overlap and can expose
        // the root background while both layers are off-canvas.
        const from = cursor;
        const shownDuration = duration;

        const src = assets[shot.source_filename] || "";

        // Keep the decoded source range internally consistent. Independent
        // rounding of start/end can produce one fewer source frame than the
        // Sequence expects (e.g. 3.35s -> 5.00s), which can render a black
        // final frame at a shot boundary.
        // Source clips in the current ATLAS footage are 25fps while the
        // composition is 30fps. Source trim frames must therefore use the
        // source rate, not the composition rate.
        const sourceFps = 25;
        const sourceStartFrame = Math.max(
          0,
          Math.round(Number(shot.start) * sourceFps)
        );
        const sourceFrameCount = Math.max(
          1,
          Math.ceil((Number(shot.end) - Number(shot.start)) * sourceFps)
        );

        const node = (
          <Sequence
            key={shot.id}
            from={from}
            durationInFrames={shownDuration}
          >
            <ShotLayer
              shot={{
                ...shot,
                transition_in: transitionIn,
                transition_out: transitionOut,
                transition_duration: shot.transition_duration,
                transition_direction:
                  shot.transition_direction ??
                  nextShot?.transition_direction,
              }}
              src={src}
              duration={duration}
              index={index}
              transitionInFrames={transitionInFrames}
              transitionOutFrames={transitionOutFrames}
              sourceStartFrame={sourceStartFrame}
              sourceFrameCount={sourceFrameCount}
            />
          </Sequence>
        );

        // The next shot begins before this shot ends by exactly `overlap`.
        cursor += duration - overlap;
        return node;
      })}

      {voice && <Audio src={staticFile(voice)} volume={1} />}

      {music && (
        <Audio
          src={staticFile(music)}
          volume={musicVolume}
        />
      )}

      {sfx.map((event, index) => {
        if (!event.source) return null;

        const start = Math.max(
          0,
          Math.round(Number(event.start || 0) * fps)
        );

        const duration = Math.max(
          1,
          Math.round(Number(event.duration || 0.8) * fps)
        );

        const volume = clamp(
          Number(event.volume) || 0.15,
          0.02,
          0.5
        );

        return (
          <Sequence
            key={`sfx-${index}`}
            from={start}
            durationInFrames={duration}
          >
            <Audio
              src={staticFile(event.source)}
              volume={(f: number) => {
                const total = Math.max(1, duration);
                const fadeInFrames = Math.min(
                  Math.round(Number(event.fadeIn || 0) * fps),
                  Math.floor(total / 3)
                );
                const fadeOutFrames = Math.min(
                  Math.round(Number(event.fadeOut || 0) * fps),
                  Math.floor(total / 3)
                );

                let gain = 1;

                if (fadeInFrames > 0) {
                  gain *= clamp(f / fadeInFrames, 0, 1);
                }

                if (fadeOutFrames > 0) {
                  gain *= clamp(
                    (total - 1 - f) / fadeOutFrames,
                    0,
                    1
                  );
                }

                return volume * gain;
              }}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
