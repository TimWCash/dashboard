import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND, COLORS } from "../constants";
import { Mark } from "../components/FrameChrome";

export const LogoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const markProgress = spring({
    frame,
    fps,
    config: { damping: 18, stiffness: 90, mass: 0.8 },
  });
  const markScale = interpolate(markProgress, [0, 1], [0.6, 1]);
  const markOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Wordmark wipes in letter by letter via clip-path.
  const wipe = interpolate(frame, [18, 60], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const subtitleOpacity = interpolate(frame, [70, 100], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const subtitleY = interpolate(frame, [70, 100], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ruleProgress = interpolate(frame, [40, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const outOpacity = interpolate(
    frame,
    [durationInFrames - 25, durationInFrames - 5],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: outOpacity,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 36,
        }}
      >
        <div
          style={{
            transform: `scale(${markScale})`,
            opacity: markOpacity,
          }}
        >
          <Mark size={140} />
        </div>

        <div
          style={{
            position: "relative",
            overflow: "hidden",
            padding: "0 4px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: 132,
              letterSpacing: 14,
              fontWeight: 800,
              color: COLORS.ink,
              clipPath: `inset(0 ${100 - wipe}% 0 0)`,
              WebkitClipPath: `inset(0 ${100 - wipe}% 0 0)`,
            }}
          >
            {BRAND.name}
          </h1>
        </div>

        <div
          style={{
            width: 460,
            height: 1,
            background: COLORS.rule,
            transform: `scaleX(${ruleProgress})`,
            transformOrigin: "center",
          }}
        />

        <div
          style={{
            opacity: subtitleOpacity,
            transform: `translateY(${subtitleY}px)`,
            fontSize: 22,
            letterSpacing: 8,
            color: COLORS.accentBright,
            fontWeight: 500,
          }}
        >
          OPERATIONS · DESIGN · THROUGHPUT
        </div>
      </div>
    </AbsoluteFill>
  );
};
