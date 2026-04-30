import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { BRAND, COLORS } from "../constants";

export const EventScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const cardSpring = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 90, mass: 0.7 },
  });
  const cardScale = interpolate(cardSpring, [0, 1], [0.94, 1]);
  const cardOpacity = interpolate(frame, [0, 24], [0, 1], {
    extrapolateRight: "clamp",
  });

  const linesIn = (start: number) =>
    interpolate(frame, [start, start + 20], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  const linesY = (start: number) =>
    interpolate(frame, [start, start + 20], [16, 0], {
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
          opacity: cardOpacity,
          transform: `scale(${cardScale})`,
          padding: "72px 120px",
          border: `1px solid ${COLORS.rule}`,
          background:
            "linear-gradient(180deg, rgba(21,32,51,0.45), rgba(7,11,20,0.55))",
          backdropFilter: "blur(2px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
          minWidth: 1100,
        }}
      >
        <div
          style={{
            opacity: linesIn(20),
            transform: `translateY(${linesY(20)}px)`,
            fontSize: 18,
            letterSpacing: 8,
            color: COLORS.accent,
            fontWeight: 600,
          }}
        >
          NOW PRESENTING AT
        </div>

        <div
          style={{
            opacity: linesIn(36),
            transform: `translateY(${linesY(36)}px)`,
            fontSize: 96,
            fontWeight: 700,
            letterSpacing: -1,
            lineHeight: 1.05,
            textAlign: "center",
            color: COLORS.ink,
          }}
        >
          {BRAND.event}
        </div>

        <div
          style={{
            opacity: linesIn(58),
            transform: `translateY(${linesY(58)}px)`,
            display: "flex",
            alignItems: "center",
            gap: 28,
            marginTop: 8,
          }}
        >
          <Pill label="LIVE DEMOS" />
          <Pill label="CASE STUDIES" />
          <Pill label={`BOOTH ${BRAND.booth}`} highlighted />
        </div>
      </div>
    </AbsoluteFill>
  );
};

const Pill: React.FC<{ label: string; highlighted?: boolean }> = ({
  label,
  highlighted,
}) => {
  return (
    <div
      style={{
        padding: "12px 22px",
        border: `1px solid ${highlighted ? COLORS.accent : COLORS.rule}`,
        color: highlighted ? COLORS.accentBright : COLORS.inkDim,
        fontSize: 18,
        letterSpacing: 4,
        fontWeight: 600,
        background: highlighted
          ? "rgba(232,184,106,0.08)"
          : "transparent",
      }}
    >
      {label}
    </div>
  );
};
