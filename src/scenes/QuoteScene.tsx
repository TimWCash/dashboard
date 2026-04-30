import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, QUOTE } from "../constants";
import { AnimatedWords } from "../components/AnimatedWord";

export const QuoteScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const markIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateRight: "clamp",
  });
  const markScale = interpolate(frame, [0, 18], [0.7, 1], {
    extrapolateRight: "clamp",
  });

  const ruleScale = interpolate(frame, [50, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const attribIn = interpolate(frame, [110, 150], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const attribY = interpolate(frame, [110, 150], [12, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const outOpacity = interpolate(
    frame,
    [durationInFrames - 28, durationInFrames - 5],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: outOpacity,
        padding: "0 200px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 48,
          maxWidth: 1500,
        }}
      >
        {/* Oversized open-quote glyph */}
        <div
          style={{
            opacity: markIn,
            transform: `scale(${markScale})`,
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontSize: 240,
            lineHeight: 0.8,
            color: COLORS.accent,
            fontWeight: 700,
            height: 120,
            display: "flex",
            alignItems: "flex-start",
          }}
        >
          “
        </div>

        <AnimatedWords
          text={QUOTE.body}
          startFrame={20}
          stagger={5}
          style={{
            fontSize: 84,
            fontWeight: 600,
            letterSpacing: -0.5,
            lineHeight: 1.15,
            color: COLORS.ink,
            textAlign: "center",
          }}
        />

        <div
          style={{
            width: 200,
            height: 2,
            background: COLORS.accent,
            transform: `scaleX(${ruleScale})`,
            transformOrigin: "center",
          }}
        />

        <div
          style={{
            opacity: attribIn,
            transform: `translateY(${attribY}px)`,
            fontSize: 22,
            letterSpacing: 6,
            color: COLORS.accentBright,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          {QUOTE.attribution}
        </div>
      </div>
    </AbsoluteFill>
  );
};
