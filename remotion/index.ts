import React from "react";
import { Composition, registerRoot } from "remotion";
import { AtlasRemotionEdit } from "./AtlasRemotionEdit";

type Props = React.ComponentProps<typeof AtlasRemotionEdit>;

const shotDurationSeconds = (shot: any) => {
  const source = Math.max(0.25, Number(shot.end || 0) - Number(shot.start || 0));
  const curve = Array.isArray(shot.speed_curve) && shot.speed_curve.length > 1
    ? shot.speed_curve
    : [{ at: 0, speed: Number(shot.speed) || 1 }, { at: 1, speed: Number(shot.speed) || 1 }];
  const effective = curve.reduce((sum: number, point: any, i: number) => {
    const prev = i === 0 ? curve[0] : curve[i - 1];
    const width = Math.max(0, Number(point.at || 0) - Number(prev.at || 0));
    return sum + width / Math.max(0.5, Number(prev.speed) || 1);
  }, 0);
  return source * (effective || 1);
};

const Root: React.FC = () =>
  React.createElement(Composition, {
    id: "ATLAS-PRO-EDIT",
    component: AtlasRemotionEdit as React.FC<Record<string, unknown>>,
    width: 1080,
    height: 1920,
    fps: 30,
    durationInFrames: 450,
    defaultProps: {
      shots: [], assets: {}, fps: 30, width: 1080, height: 1920,
    } as Props,
    calculateMetadata: ({ props }: { props: Record<string, unknown> }) => {
      const typed = props as Props;
      const seconds = typed.shots.reduce((sum, shot) => sum + shotDurationSeconds(shot), 0);
      return { durationInFrames: Math.max(1, Math.round(seconds * typed.fps)) };
    },
  });

registerRoot(Root);
