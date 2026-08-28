import React from "react";
import { Composition, registerRoot } from "remotion";
import { AtlasProEditV2 } from "./AtlasProEditV2";

type Props = React.ComponentProps<typeof AtlasProEditV2>;

const shotDurationSeconds = (shot: any) => {
  const source = Math.max(0.25, Number(shot.end || 0) - Number(shot.start || 0));
  const speed = Math.max(0.5, Number(shot.speed) || 1);
  return source / speed;
};

const transitionOverlap = (shot: any, next: any, fps: number) => {
  if (!next) return 0;
  const type = String(next.transition_in || shot.transition_out || "CUT").toUpperCase();
  const enabled = ["DISSOLVE","FADE","CROSSFADE","MATCH","WHIP","SLIDE_LEFT","SLIDE_RIGHT","SLIDE_UP","SLIDE_DOWN","ZOOM","PUNCH"].includes(type);
  if (!enabled) return 0;
  return Math.min(Math.round(0.28 * fps), Math.floor(Math.max(1, shotDurationSeconds(shot) * fps) * 0.18));
};

const Root: React.FC = () => React.createElement(Composition, {
  id: "ATLAS-PRO-EDIT",
  component: AtlasProEditV2 as React.FC<Record<string, unknown>>,
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 450,
  defaultProps: { shots: [], assets: {}, fps: 30, width: 1080, height: 1920 } as Props,
  calculateMetadata: ({ props }: { props: Record<string, unknown> }) => {
    const typed = props as Props;
    let frames = 0;
    typed.shots.forEach((shot, i) => {
      frames += Math.max(1, Math.round(shotDurationSeconds(shot) * typed.fps));
      frames -= transitionOverlap(shot, typed.shots[i + 1], typed.fps);
    });
    return { durationInFrames: Math.max(1, frames) };
  },
});

registerRoot(Root);
