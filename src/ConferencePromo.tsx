import React from "react";
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { COLORS, SCENES } from "./constants";
import { MotionBackground } from "./components/MotionBackground";
import { Vignette } from "./components/Vignette";
import { FrameChrome } from "./components/FrameChrome";
import { LogoScene } from "./scenes/LogoScene";
import { TaglineScene } from "./scenes/TaglineScene";
import { EventScene } from "./scenes/EventScene";
import { ProblemsScene } from "./scenes/ProblemsScene";
import { WhatWeDoScene } from "./scenes/WhatWeDoScene";
import { CtaScene } from "./scenes/CtaScene";

const SCENE_COMPONENTS: Record<string, React.FC> = {
  logo: LogoScene,
  tagline: TaglineScene,
  event: EventScene,
  problems: ProblemsScene,
  whatWeDo: WhatWeDoScene,
  cta: CtaScene,
};

export const ConferencePromo: React.FC = () => {
  const { width, height } = useVideoConfig();

  let cursor = 0;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.bgDeep,
        width,
        height,
        fontFamily: "Inter, system-ui, sans-serif",
        color: COLORS.ink,
        overflow: "hidden",
      }}
    >
      <MotionBackground />
      <Vignette />

      {SCENES.map((scene) => {
        const Component = SCENE_COMPONENTS[scene.id];
        const from = cursor;
        cursor += scene.durationInFrames;
        if (!Component) return null;
        return (
          <Sequence
            key={scene.id}
            from={from}
            durationInFrames={scene.durationInFrames}
            name={scene.id}
          >
            <Component />
          </Sequence>
        );
      })}

      <FrameChrome />
    </AbsoluteFill>
  );
};
