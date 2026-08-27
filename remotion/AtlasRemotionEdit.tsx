import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

type Caption = {
  text: string;
  start: number;
  end: number;
  emphasis?: boolean;
  style?: string;
  position?: string;
};

type Sfx = {
  source?: string;
  start?: number;
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
};

type Shot = {
  id: string;
  role: string;
  source_filename: string;
  start: number;
  end: number;

  crop?: string;
  zoom?: number;
  motion?: string;
  transition_in?: string;
  transition_out?: string;
  speed?: number;
  speed_curve?: Array<{ at?: number; speed?: number }>;
  zoom_start?: number;
  zoom_end?: number;
  source_audio_volume?: number;
  sfx?: string[];
  sfx_events?: Array<{ type?: string; at?: number; volume?: number }>;
  color_treatment?: string;
  beat_intent?: string;
  cut_on?: string;

  x?: number;
  y?: number;
  rotation?: number;

  brightness?: number;
  contrast?: number;
  saturation?: number;
  blur?: number;
  overlay_opacity?: number;

  on_screen_text?: string;
  text_position?: string;
  text_style?: string;
  text_animation?: string;
  text_size?: number;
  text_color?: string;
  text_weight?: number;
  emphasis_words?: string[];
};

type Props = {
  shots: Shot[];
  assets: Record<string, string>;

  voice?: string;
  music?: string;
  musicVolume?: number;
  music_curve?: Array<{ at?: number; level?: number }>;
  musicDucking?: boolean;
  musicDuckingDb?: number;
  voicePriority?: string;

  fps: number;
  width: number;
  height: number;

  captions?: Caption[];
  sfx?: Sfx[];

  brand?: {
    primaryColor?: string;
    secondaryColor?: string;
    fontFamily?: string;
    logo?: string;
  };
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const curveValue = (curve: Array<{ at?: number; speed?: number; level?: number }> | undefined, progress: number, key: "speed" | "level", fallback: number) => {
  if (!Array.isArray(curve) || curve.length < 2) return fallback;
  const points = curve
    .map((p) => ({ at: clamp(Number(p.at) || 0, 0, 1), value: clamp(Number(p[key]) || fallback, key === "speed" ? 0.5 : 0, key === "speed" ? 2 : 1) }))
    .sort((a, b) => a.at - b.at);
  if (progress <= points[0].at) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    if (progress <= points[i].at) {
      const a = points[i - 1];
      const b = points[i];
      const t = (progress - a.at) / Math.max(0.0001, b.at - a.at);
      return a.value + (b.value - a.value) * t;
    }
  }
  return points[points.length - 1].value;
};

const cropPosition = (crop?: string) => {
  const value = String(crop || "CENTER").toUpperCase();

  if (value === "FACE") return "50% 38%";
  if (value === "PRODUCT") return "50% 52%";
  if (value === "ACTION") return "50% 55%";
  if (value === "TOP") return "50% 30%";
  if (value === "BOTTOM") return "50% 70%";
  if (value === "LEFT") return "30% 50%";
  if (value === "RIGHT") return "70% 50%";
  if (value === "TOP_LEFT") return "30% 30%";
  if (value === "TOP_RIGHT") return "70% 30%";
  if (value === "BOTTOM_LEFT") return "30% 70%";
  if (value === "BOTTOM_RIGHT") return "70% 70%";

  return "50% 50%";
};

const textPosition = (position?: string) => {
  const p = String(position || "BOTTOM").toLowerCase();

  if (p.includes("top")) {
    return { top: 135, bottom: "auto" as const };
  }

  if (p.includes("middle") || p.includes("center")) {
    return {
      top: "50%",
      bottom: "auto" as const,
      transformOrigin: "center",
    };
  }

  if (p.includes("bottom")) {
    return { bottom: 190, top: "auto" as const };
  }

  return { bottom: 190, top: "auto" as const };
};

const transitionName = (value?: string) =>
  String(value || "CUT").trim().toUpperCase();

const motionName = (value?: string) =>
  String(value || "STATIC").trim().toUpperCase();

const normalizedTextStyle = (value?: string) =>
  String(value || "CLEAN").trim().toUpperCase();

const colorPreset = (value?: string) => {
  const key = String(value || "CLEAN_PREMIUM").toUpperCase();
  const presets: Record<string, { brightness: number; contrast: number; saturation: number }> = {
    NATURAL: { brightness: 1.00, contrast: 1.03, saturation: 1.00 },
    CLEAN_PREMIUM: { brightness: 1.02, contrast: 1.10, saturation: 1.02 },
    CRISP_DETAIL: { brightness: 1.01, contrast: 1.18, saturation: 0.99 },
    DARK_LUXURY: { brightness: 0.97, contrast: 1.20, saturation: 0.94 },
    PUNCHY: { brightness: 1.01, contrast: 1.22, saturation: 1.08 },
    WARM: { brightness: 1.03, contrast: 1.08, saturation: 1.06 },
    COOL: { brightness: 1.01, contrast: 1.10, saturation: 0.97 },
  };
  return presets[key] || presets.CLEAN_PREMIUM;
};

const sfxSource = (label?: string) => {
  const key = String(label || "NONE").toUpperCase();
  const map: Record<string, string> = {
    WHOOSH: "sfx/whoosh.wav",
    HOOK_IMPACT: "sfx/impact.wav",
    REVEAL_IMPACT: "sfx/impact.wav",
    CTA_HIT: "sfx/click.wav",
    CLICK: "sfx/click.wav",
    POP: "sfx/pop.wav",
    WATER: "sfx/spray.wav",
    FOAM: "sfx/spray.wav",
    WIPE: "sfx/wipe.wav",
    MACHINE: "sfx/whoosh.wav",
    SWIPE: "sfx/whoosh.wav",
  };
  return map[key] || "";
};

const ShotLayer: React.FC<{
  shot: Shot;
  src: string;
  durationInFrames: number;
  index: number;
  captions: Caption[];
  brand?: Props["brand"];
}> = ({ shot, src, durationInFrames, index, captions, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress =
    durationInFrames <= 1
      ? 1
      : clamp(frame / (durationInFrames - 1), 0, 1);

  const baseSpeed = clamp(Number(shot.speed) || 1, 0.25, 3);
  const speed = curveValue(shot.speed_curve, progress, "speed", baseSpeed);
  const zoomStart = clamp(Number(shot.zoom_start ?? shot.zoom) || 1, 1, 1.55);
  const zoomEnd = clamp(Number(shot.zoom_end ?? shot.zoom) || zoomStart, 1, 1.65);
  const directorZoom = interpolate(progress, [0, 1], [zoomStart, zoomEnd], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const transitionIn = transitionName(shot.transition_in);
  const transitionOut = transitionName(shot.transition_out);
  const motion = motionName(shot.motion);

  const edge = Math.min(18, Math.max(4, Math.floor(durationInFrames * 0.16)));
  const enterProgress = clamp(frame / edge, 0, 1);
  const exitProgress = clamp(
    (durationInFrames - 1 - frame) / edge,
    0,
    1
  );
  const enterEase = Easing.out(Easing.cubic)(enterProgress);
  const exitEase = Easing.out(Easing.cubic)(exitProgress);

  // ------------------------------------------------------------
  // TRANSITIONS — execution only, no creative improvisation.
  // ------------------------------------------------------------
  let opacity = 1;
  let transitionX = 0;
  let transitionY = 0;
  let transitionBlur = 0;
  let transitionScale = 1;
  let flashOpacity = 0;

  if (transitionIn === "DISSOLVE" || transitionIn === "FADE") {
    opacity = enterEase;
  }

  if (transitionIn === "WHIP") {
    transitionX = interpolate(
      enterEase,
      [0, 1],
      [index % 2 === 0 ? -11 : 11, 0]
    );
    transitionBlur = interpolate(enterEase, [0, 1], [10, 0]);
  }

  if (transitionIn === "SLIDE_LEFT") {
    transitionX = interpolate(enterEase, [0, 1], [100, 0]);
  }

  if (transitionIn === "SLIDE_RIGHT") {
    transitionX = interpolate(enterEase, [0, 1], [-100, 0]);
  }

  if (transitionIn === "SLIDE_UP") {
    transitionY = interpolate(enterEase, [0, 1], [100, 0]);
  }

  if (transitionIn === "SLIDE_DOWN") {
    transitionY = interpolate(enterEase, [0, 1], [-100, 0]);
  }

  if (transitionIn === "ZOOM" || transitionIn === "PUNCH") {
    transitionScale = interpolate(
      enterEase,
      [0, 0.72, 1],
      transitionIn === "PUNCH" ? [1.18, 1.035, 1] : [1.14, 1.018, 1]
    );
  }

  if (transitionIn === "FLASH") {
    flashOpacity = interpolate(enterEase, [0, 0.25, 1], [0.9, 0.25, 0]);
  }

  if (transitionIn === "MATCH") {
    transitionScale = interpolate(enterEase, [0, 1], [1.06, 1]);
    opacity = interpolate(enterEase, [0, 1], [0, 1]);
  }

  if (transitionOut === "DISSOLVE" || transitionOut === "FADE") {
    opacity *= exitEase;
  }

  if (transitionOut === "FLASH") {
    flashOpacity = Math.max(
      flashOpacity,
      interpolate(1 - exitProgress, [0, 0.25, 1], [0, 0.25, 0.75])
    );
  }

  // ------------------------------------------------------------
  // CAMERA / MOTION — driven by the Director's motion field.
  // ------------------------------------------------------------
  const userX = Number(shot.x) || 0;
  const userY = Number(shot.y) || 0;
  const rotation = Number(shot.rotation) || 0;

  let motionX = 0;
  let motionY = 0;
  let motionScale = directorZoom;
  let motionRotation = 0;

  if (motion === "PUSH_IN") {
    motionScale = directorZoom + 0.015;
  } else if (motion === "PUSH_OUT") {
    motionScale = directorZoom + 0.01;
  } else if (motion === "PAN_LEFT") {
    motionX = interpolate(progress, [0, 1], [1.8, -1.8]);
  } else if (motion === "PAN_RIGHT") {
    motionX = interpolate(progress, [0, 1], [-1.8, 1.8]);
  } else if (motion === "TILT_UP") {
    motionY = interpolate(progress, [0, 1], [1.6, -1.6]);
  } else if (motion === "TILT_DOWN") {
    motionY = interpolate(progress, [0, 1], [-1.6, 1.6]);
  } else if (motion === "HANDHELD") {
    const seed = index * 17.31;
    motionX = Math.sin(frame * 0.19 + seed) * 0.42;
    motionY = Math.cos(frame * 0.23 + seed) * 0.34;
    motionRotation = Math.sin(frame * 0.11 + seed) * 0.18;
  } else if (motion === "DRIFT") {
    motionX = interpolate(progress, [0, 1], [-1.1, 1.1]);
    motionY = interpolate(progress, [0, 1], [0.7, -0.7]);
  }

  const scale = motionScale * transitionScale;
  const finalX = motionX + userX + transitionX;
  const finalY = motionY + userY + transitionY;
  const finalRotation = rotation + motionRotation;

  const bridgeOpacity = interpolate(
    enterEase,
    [0, 0.22, 0.72, 1],
    [0.0, 0.22, 0.06, 0.0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const bridgeGradient =
    transitionIn === "WHIP"
      ? "linear-gradient(90deg, transparent 0%, rgba(255,255,255,.34) 47%, transparent 100%)"
      : transitionIn === "SLIDE_LEFT" || transitionIn === "SLIDE_RIGHT"
        ? "linear-gradient(90deg, transparent 0%, rgba(255,255,255,.16) 50%, transparent 100%)"
        : "radial-gradient(circle at center, rgba(255,255,255,.22), transparent 58%)";

  // ------------------------------------------------------------
  // COLOR / VISUAL TREATMENT
  // ------------------------------------------------------------
  const preset = colorPreset(shot.color_treatment);
  const brightness = clamp(Number(shot.brightness) || preset.brightness, 0.65, 1.35);
  const contrast = clamp(Number(shot.contrast) || preset.contrast, 0.7, 1.5);
  const saturation = clamp(Number(shot.saturation) || preset.saturation, 0, 1.8);
  const blur = transitionBlur + clamp(Number(shot.blur) || 0, 0, 12);

  const visualFilter = [
    `brightness(${brightness})`,
    `contrast(${contrast})`,
    `saturate(${saturation})`,
    blur > 0 ? `blur(${blur}px)` : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ------------------------------------------------------------
  // ON-SCREEN TEXT / KINETIC TYPOGRAPHY
  // ------------------------------------------------------------
  const text = String(shot.on_screen_text || "").trim();
  const textAnimation = String(shot.text_animation || "FADE").toUpperCase();
  const textStyle = normalizedTextStyle(shot.text_style);

  const textInFrames = Math.min(18, Math.max(5, Math.floor(durationInFrames * 0.16)));
  const textOutFrames = Math.min(14, Math.max(4, Math.floor(durationInFrames * 0.12)));

  const textOpacityIn = interpolate(frame, [0, textInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const textOpacityOut = interpolate(
    frame,
    [Math.max(0, durationInFrames - textOutFrames), durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const textOpacity = textOpacityIn * textOpacityOut;

  const textSpring = spring({
    frame: Math.max(0, frame - 2),
    fps,
    config: { damping: 18, stiffness: 150, mass: 0.55 },
  });

  let textTranslateX = 0;
  let textTranslateY = 0;
  let textScale = 1;
  let textRotation = 0;

  if (textAnimation === "SLIDE_UP") {
    textTranslateY = interpolate(textSpring, [0, 1], [38, 0]);
  } else if (textAnimation === "SLIDE_DOWN") {
    textTranslateY = interpolate(textSpring, [0, 1], [-38, 0]);
  } else if (textAnimation === "SLIDE_LEFT") {
    textTranslateX = interpolate(textSpring, [0, 1], [70, 0]);
  } else if (textAnimation === "SLIDE_RIGHT") {
    textTranslateX = interpolate(textSpring, [0, 1], [-70, 0]);
  } else if (textAnimation === "POP") {
    textScale = interpolate(textSpring, [0, 1], [0.78, 1]);
  } else if (textAnimation === "BOUNCE") {
    textScale = 0.92 + textSpring * 0.08;
    textTranslateY = (1 - textSpring) * 24;
  } else if (textAnimation === "ROTATE") {
    textRotation = interpolate(textSpring, [0, 1], [-5, 0]);
    textScale = interpolate(textSpring, [0, 1], [0.94, 1]);
  } else if (textAnimation === "TYPEWRITER") {
    // The actual string remains stable for deterministic rendering; the
    // clip is revealed progressively with a width mask.
  }

  const isHook = shot.role === "HOOK";
  const isCTA = shot.role === "CTA";
  const isMinimal = textStyle === "MINIMAL" || textStyle === "CLEAN";
  const isAccent = textStyle === "PRICE_ACCENT" || textStyle === "WORD_EMPHASIS";

  const fontSize =
    Number(shot.text_size) ||
    (isCTA ? 68 : isHook ? 72 : 52);

  const fontFamily =
    brand?.fontFamily ||
    (isHook || isCTA
      ? 'Inter, "Arial Black", "Segoe UI", Arial, sans-serif'
      : 'Inter, "Segoe UI", Arial, sans-serif');

  const textColor = shot.text_color || brand?.primaryColor || "#FFFFFF";
  const secondaryColor = brand?.secondaryColor || "#C8FF2B";
  const displayText = isMinimal ? text : text.toUpperCase();
  const words = displayText.split(/\s+/).filter(Boolean);
  const wordStagger = Math.max(
    2,
    Math.floor(Math.min(7, durationInFrames * 0.045))
  );
  const wordReveal =
    textAnimation === "WORD_POP" ||
    textAnimation === "WORD_REVEAL";

  const textShadow =
    textStyle === "OUTLINE"
      ? `0 0 0 #000, 3px 0 0 #000, -3px 0 0 #000, 0 3px 0 #000, 0 -3px 0 #000`
      : "0 5px 20px rgba(0,0,0,.72)";

  const textBackground =
    textStyle === "BOX" || textStyle === "LABEL"
      ? "rgba(0,0,0,.62)"
      : "transparent";

  const textBorderRadius = textStyle === "LABEL" ? 14 : 0;
  const textPadding = textStyle === "BOX" || textStyle === "LABEL" ? "12px 20px" : "10px 18px";

  // ------------------------------------------------------------
  // CAPTION TIMELINE
  // ------------------------------------------------------------
  const activeCaption = captions.find((caption) => {
    const localTime = Number(shot.start) + frame / fps;
    return localTime >= caption.start && localTime <= caption.end;
  });

  const captionPosition = textPosition(activeCaption?.position || "BOTTOM");
  const captionStyle = String(activeCaption?.style || "CLEAN").toUpperCase();

  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#050505" }}>
      <AbsoluteFill style={{ opacity, overflow: "hidden" }}>
        <OffthreadVideo
          src={src}
          muted={Number(shot.source_audio_volume || 0) <= 0}
          volume={clamp(Number(shot.source_audio_volume) || 0, 0, 1)}
          startFrom={Math.max(0, Math.floor((Number(shot.start) || 0) * fps))}
          playbackRate={speed}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: cropPosition(shot.crop),
            filter: visualFilter,
            transform: `translateX(${finalX}%) translateY(${finalY}%) rotate(${finalRotation}deg) scale(${scale})`,
          }}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            "radial-gradient(circle at center, transparent 45%, rgba(0,0,0,.28) 100%)",
          opacity: 0.72,
        }}
      />

      {flashOpacity > 0 ? (
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            background: "white",
            opacity: flashOpacity,
          }}
        />
      ) : null}

      {transitionIn !== "CUT" && transitionIn !== "DISSOLVE" && transitionIn !== "FADE" ? (
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            opacity: bridgeOpacity,
            background: bridgeGradient,
            transform:
              transitionIn === "WHIP"
                ? `translateX(${interpolate(enterEase, [0, 1], [-42, 42])}%) skewX(-10deg)`
                : transitionIn === "SLIDE_LEFT"
                  ? `translateX(${interpolate(enterEase, [0, 1], [34, -10])}%)`
                  : transitionIn === "SLIDE_RIGHT"
                    ? `translateX(${interpolate(enterEase, [0, 1], [-34, 10])}%)`
                    : "scale(1.06)",
            filter: transitionIn === "WHIP" ? "blur(1.5px)" : "none",
          }}
        />
      ) : null}

      {text ? (
        <div
          style={{
            position: "absolute",
            left: isHook || isCTA ? 72 : 62,
            right: isHook || isCTA ? 72 : 62,
            ...textPosition(shot.text_position),
            opacity: textOpacity * opacity,
            transform: `translateX(${textTranslateX}px) translateY(${textTranslateY}px) rotate(${textRotation}deg) scale(${textScale})`,
            transformOrigin: "center",
            fontFamily,
            fontWeight: Number(shot.text_weight) || (isHook || isCTA ? 950 : 800),
            fontSize,
            lineHeight: isHook || isCTA ? 0.9 : 1.0,
            letterSpacing: isHook ? -2.4 : isCTA ? -1.7 : isAccent ? -0.7 : 0.2,
            color: textColor,
            textAlign: isHook || isCTA ? "left" : "center",
            textShadow,
            background: textBackground,
            borderRadius: textBorderRadius,
            padding: textPadding,
            whiteSpace: "pre-wrap",
            textTransform: isMinimal ? "none" : "uppercase",
            maxWidth: "100%",
          }}
        >
          {wordReveal
            ? words.map((word, wordIndex) => {
                const local = interpolate(
                  frame,
                  [2 + wordIndex * wordStagger, 7 + wordIndex * wordStagger],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                );
                return (
                  <span
                    key={`${word}-${wordIndex}`}
                    style={{
                      display: "inline-block",
                      marginRight: wordIndex === words.length - 1 ? 0 : 10,
                      opacity: local,
                      transform: `translateY(${(1 - local) * 18}px) scale(${0.94 + local * 0.06})`,
                      color:
                        (Array.isArray(shot.emphasis_words) && shot.emphasis_words.some((w) => String(w).toLowerCase() === word.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase())) ||
                        (isAccent && wordIndex === words.length - 1)
                          ? secondaryColor
                          : textColor,
                    }}
                  >
                    {word}
                  </span>
                );
              })
            : displayText}
        </div>
      ) : null}

      {text && (isHook || isCTA || isAccent) ? (
        <div
          style={{
            position: "absolute",
            ...textPosition(shot.text_position),
            left: isHook || isCTA ? 72 : "50%",
            marginTop: isHook || isCTA ? 92 : 78,
            width: interpolate(
              textSpring,
              [0, 1],
              [0, isCTA ? 180 : isHook ? 150 : 90]
            ),
            height: 5,
            borderRadius: 99,
            background: secondaryColor,
            opacity: textOpacity * opacity * 0.92,
            boxShadow: `0 0 18px ${secondaryColor}66`,
            transform: isHook || isCTA ? "none" : "translateX(-50%)",
          }}
        />
      ) : null}

      {activeCaption ? (
        <div
          style={{
            position: "absolute",
            left: 65,
            right: 65,
            ...captionPosition,
            textAlign: "center",
            fontFamily,
            fontWeight: activeCaption.emphasis ? 950 : 750,
            fontSize: activeCaption.emphasis ? 48 : 43,
            lineHeight: 1.05,
            color:
              activeCaption.emphasis || captionStyle === "HIGHLIGHT"
                ? secondaryColor
                : "#FFFFFF",
            textShadow:
              captionStyle === "OUTLINE"
                ? "2px 0 #000,-2px 0 #000,0 2px #000,0 -2px #000"
                : "0 4px 18px rgba(0,0,0,.85)",
          }}
        >
          {activeCaption.text}
        </div>
      ) : null}

    </AbsoluteFill>
  );
};

export const AtlasRemotionEdit: React.FC<Props> = (props) => {
  const { fps } = useVideoConfig();
  let cursor = 0;
  const shotRanges: Array<{ from: number; frames: number; shot: Shot }> = [];

  return (
    <AbsoluteFill style={{ background: "#050505" }}>
      {props.shots.map((shot, index) => {
        const sourceDuration = Math.max(0.25, Number(shot.end) - Number(shot.start));
        const curve = Array.isArray(shot.speed_curve) && shot.speed_curve.length > 1 ? shot.speed_curve : [{ at: 0, speed: Number(shot.speed) || 1 }, { at: 1, speed: Number(shot.speed) || 1 }];
        const avgSpeed = curve.reduce((sum: number, p: any, i: number) => {
          const prev = i === 0 ? curve[0] : curve[i - 1];
          const width = Math.max(0, Number(p.at || 0) - Number(prev.at || 0));
          return sum + width / Math.max(0.5, Number(prev.speed) || 1);
        }, 0) || (1 / Math.max(0.5, Number(shot.speed) || 1));
        const renderedSeconds = sourceDuration * avgSpeed;
        const frames = Math.max(1, Math.round(renderedSeconds * fps));
        const from = cursor;
        cursor += frames;
        shotRanges.push({ from, frames, shot });

        const asset = props.assets[shot.source_filename];
        if (!asset) return null;

        return (
          <Sequence
            key={`${shot.id}-${index}`}
            from={from}
            durationInFrames={frames}
            layout="none"
          >
            <ShotLayer
              shot={shot}
              src={staticFile(asset)}
              durationInFrames={frames}
              index={index}
              captions={props.captions || []}
              brand={props.brand}
            />
          </Sequence>
        );
      })}

      {props.voice ? (
        <Audio src={staticFile(props.voice)} volume={1} />
      ) : null}

      {props.music ? (
        <Audio
          src={staticFile(props.music)}
          volume={(frame) => {
            const globalBase = clamp(Number(props.musicVolume) || 0.12, 0, 1);
            const active = shotRanges.find((r) => frame >= r.from && frame < r.from + r.frames);
            let localLevel = active ? curveValue(active.shot.music_curve, clamp((frame - active.from) / Math.max(1, active.frames - 1), 0, 1), "level", Number(active.shot.music_volume) || 0.65) : 1;
            const base = clamp(globalBase * (0.55 + localLevel * 0.65), 0, 1);
            if (!props.voice || props.musicDucking === false) return base;

            const priority = String(props.voicePriority || "HIGH").toUpperCase();
            const db = Number(props.musicDuckingDb) || (priority === "HIGH" ? 12 : 9);
            const linear = Math.pow(10, -Math.abs(db) / 20);
            const time = frame / fps;
            const duck = (props.captions || []).reduce((maxGain, caption) => {
              const start = Number(caption.start || 0);
              const end = Number(caption.end || start);
              const fadeIn = 0.07;
              const fadeOut = 0.12;
              const inGain = clamp((time - start) / fadeIn, 0, 1);
              const outGain = clamp((end - time) / fadeOut, 0, 1);
              return Math.max(maxGain, inGain * outGain);
            }, 0);

            // If no captions are available, keep voice-over music conservative.
            const duckAmount = (props.captions || []).length ? duck : 0.72;
            return base * (1 - duckAmount + duckAmount * linear);
          }}
        />
      ) : null}

      {(props.sfx || []).map((effect, index) => {
        if (!effect.source) return null;

        const startFrame = Math.max(
          0,
          Math.round((Number(effect.start) || 0) * fps)
        );
        const durationFrames = Math.max(
          1,
          Math.round((Number(effect.duration) || 1) * fps)
        );
        const fadeInFrames = Math.max(
          0,
          Math.round((Number(effect.fadeIn) || 0.04) * fps)
        );
        const fadeOutFrames = Math.max(
          0,
          Math.round((Number(effect.fadeOut) || 0.06) * fps)
        );

        return (
          <Sequence
            key={`sfx-${index}`}
            from={startFrame}
            durationInFrames={durationFrames}
          >
            <Audio
              src={staticFile(effect.source)}
              volume={(frame) => {
                const base = clamp(Number(effect.volume) || 0.5, 0, 1);
                const inGain =
                  fadeInFrames > 0
                    ? interpolate(frame, [0, fadeInFrames], [0, 1], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                      })
                    : 1;
                const outGain =
                  fadeOutFrames > 0
                    ? interpolate(
                        frame,
                        [Math.max(0, durationFrames - fadeOutFrames), durationFrames],
                        [1, 0],
                        {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                        }
                      )
                    : 1;
                return base * inGain * outGain;
              }}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
