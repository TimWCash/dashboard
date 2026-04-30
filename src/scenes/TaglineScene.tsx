import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND, COLORS } from "../constants";
import { AnimatedWords } from "../components/AnimatedWord";

export const TaglineScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const kickerOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });
  const kickerY = interpolate(frame, [0, 20], [12, 0], {
    extrapolateRight: "clamp",
  });

  const ruleScale = interpolate(frame, [16, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const outOpacity = interpolate(
    frame,
    [durationInFrames - 25, durationInFrames - 5],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const tagline = BRAND.tagline.replace(/\.$/, "");

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: outOpacity,
        padding: "0 160px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 48,
        }}
      >
        <div
          style={{
            opacity: kickerOpacity,
            transform: `translateY(${kickerY}px)`,
            fontSize: 18,
            letterSpacing: 8,
            color: COLORS.accent,
            fontWeight: 600,
          }}
        >
          OUR PURPOSE
        </div>

        <AnimatedWords
          text={tagline}
          startFrame={20}
          stagger={6}
          style={{
            fontSize: 110,
            fontWeight: 700,
            letterSpacing: -1,
            lineHeight: 1.05,
            maxWidth: 1500,
            textAlign: "center",
          }}
        />

        <div
          style={{
            width: 240,
            height: 2,
            background: COLORS.accent,
            transform: `scaleX(${ruleScale})`,
            transformOrigin: "center",
            boxShadow: `0 0 24px ${COLORS.accent}`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
