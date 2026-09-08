import type {
  AtlasEditPlanV1,
  AtlasShot,
} from "./atlas-edit-contract";

export type AtlasRemotionShot = {
  id: string;
  role: string;

  source_filename: string;
  start: number;
  end: number;

  purpose: string;
  beat_intent: string;
  editorial_score: number;
  cut_on: string;

  transition_in: string;
  transition_out: string;

  motion: string;

  zoom_start: number;
  zoom_end: number;
  crop_focus: string;

  speed: number;
  speed_curve: Array<{
    at: number;
    speed: number;
  }>;

  color_treatment: string;
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;

  on_screen_text?: string;
  text_style?: string;
  text_animation?: string;
  text_position?: string;
  emphasis_words: string[];

  source_audio_volume: number;
  music_volume: number;
  music_curve: Array<{
    at: number;
    level: number;
  }>;

  sfx: string[];
  sfx_events: Array<{
    type: string;
    at: number;
    volume: number;
    duration?: number;
  }>;
};

function shotToRemotionShot(
  shot: AtlasShot,
): AtlasRemotionShot {
  return {
    id: shot.id,
    role: shot.role,

    source_filename: shot.sourceFilename,
    start: shot.timing.sourceStart,
    end: shot.timing.sourceEnd,

    purpose: shot.purpose,
    beat_intent: shot.beatIntent,
    editorial_score: shot.editorialScore,
    cut_on: shot.timing.cutOn,

    transition_in: shot.transitionIn,
    transition_out: shot.transitionOut,

    motion: shot.motion.type,

    zoom_start: shot.motion.zoomStart,
    zoom_end: shot.motion.zoomEnd,
    crop_focus: shot.motion.cropFocus,

    speed: shot.speed,
    speed_curve: shot.speedCurve,

    color_treatment: shot.visual.colorTreatment,
    brightness: shot.visual.brightness ?? 1,
    contrast: shot.visual.contrast ?? 1,
    saturation: shot.visual.saturation ?? 1,
    blur: shot.visual.blur ?? 0,

    ...(shot.text
      ? {
          on_screen_text: shot.text.content,
          text_style: shot.text.style,
          text_animation: shot.text.animation,
          text_position: shot.text.position,
          emphasis_words: shot.text.emphasisWords,
        }
      : {
          emphasis_words: [],
        }),

    source_audio_volume:
      shot.audio.sourceAudioVolume,

    music_volume:
      shot.audio.musicVolume,

    music_curve:
      shot.audio.musicCurve,

    sfx:
      shot.audio.sfx,

    sfx_events:
      shot.audio.sfxEvents,
  };
}

export function atlasPlanToRemotionShots(
  plan: AtlasEditPlanV1,
): AtlasRemotionShot[] {
  return plan.timeline.shots.map(
    shotToRemotionShot,
  );
}