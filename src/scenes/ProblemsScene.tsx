import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, PROBLEMS } from "../constants";

export const ProblemsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const kickerOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Each problem cross-fades, sharing the stage one at a time.
  const lineDuration = Math.floor((durationInFrames - 40) / PROBLEMS.length);
  const startOffset = 20;

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
        padding: "0 160px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 60,
          width: "100%",
        }}
      >
        <div
          style={{
            opacity: kickerOpacity,
            fontSize: 18,
            letterSpacing: 8,
            color: COLORS.accent,
            fontWeight: 600,
          }}
        >
          SOUND FAMILIAR?
        </div>

        <div
          style={{
            position: "relative",
            width: "100%",
            height: 220,
          }}
        >
          {PROBLEMS.map((line, i) => {
            const start = startOffset + i * lineDuration;
            const nextStart = startOffset + (i + 1) * lineDuration;
            const xfade = 8;
            const fadeIn = interpolate(
              frame,
              [start - xfade, start + xfade],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const fadeOut = interpolate(
              frame,
              [nextStart - xfade, nextStart + xfade],
              [1, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const opacity =
              i === PROBLEMS.length - 1 ? fadeIn : Math.min(fadeIn, fadeOut);

            const yIn = interpolate(
              frame,
              [start - xfade, start + xfade],
              [80, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const yOut =
              i === PROBLEMS.length - 1
                ? 0
                : interpolate(
                    frame,
                    [nextStart - xfade, nextStart + xfade],
                    [0, -80],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                  );
            const y = yIn + yOut;

            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity,
                  transform: `translateY(${y}px)`,
                }}
              >
                <div
                  style={{
                    fontSize: 96,
                    fontWeight: 700,
                    letterSpacing: -1,
                    lineHeight: 1.1,
                    color: COLORS.ink,
                    textAlign: "center",
                    maxWidth: 1500,
                  }}
                >
                  <span style={{ color: COLORS.accent, marginRight: 24 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {line}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
