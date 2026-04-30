import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CAPABILITIES, COLORS } from "../constants";

export const WhatWeDoScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const headerIn = interpolate(frame, [0, 24], [0, 1], {
    extrapolateRight: "clamp",
  });
  const headerY = interpolate(frame, [0, 24], [16, 0], {
    extrapolateRight: "clamp",
  });

  const cardsStart = 30;
  const cardStagger = 22;

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
        padding: "0 120px",
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
            opacity: headerIn,
            transform: `translateY(${headerY}px)`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 18,
          }}
        >
          <div
            style={{
              fontSize: 18,
              letterSpacing: 8,
              color: COLORS.accent,
              fontWeight: 600,
            }}
          >
            WHAT WE DO
          </div>
          <div
            style={{
              fontSize: 78,
              fontWeight: 700,
              letterSpacing: -0.5,
              color: COLORS.ink,
              textAlign: "center",
            }}
          >
            We engineer better service operations.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 28,
            width: "100%",
            maxWidth: 1680,
          }}
        >
          {CAPABILITIES.map((cap, i) => {
            const start = cardsStart + i * cardStagger;
            const s = spring({
              frame: frame - start,
              fps,
              config: { damping: 18, stiffness: 90, mass: 0.7 },
            });
            const opacity = interpolate(frame, [start, start + 16], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const y = interpolate(s, [0, 1], [40, 0]);

            return (
              <div
                key={cap.title}
                style={{
                  opacity,
                  transform: `translateY(${y}px)`,
                  padding: "36px 32px",
                  border: `1px solid ${COLORS.rule}`,
                  background:
                    "linear-gradient(180deg, rgba(21,32,51,0.55), rgba(7,11,20,0.65))",
                  display: "flex",
                  flexDirection: "column",
                  gap: 18,
                  minHeight: 360,
                }}
              >
                <div
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 16,
                    letterSpacing: 4,
                    color: COLORS.accent,
                  }}
                >
                  {cap.kicker}
                </div>
                <div
                  style={{
                    width: 48,
                    height: 2,
                    background: COLORS.accent,
                  }}
                />
                <div
                  style={{
                    fontSize: 38,
                    fontWeight: 700,
                    color: COLORS.ink,
                    letterSpacing: -0.2,
                    lineHeight: 1.1,
                  }}
                >
                  {cap.title}
                </div>
                <div
                  style={{
                    fontSize: 18,
                    lineHeight: 1.5,
                    color: COLORS.inkDim,
                    fontWeight: 400,
                  }}
                >
                  {cap.body}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
