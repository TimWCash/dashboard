import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, PROOF_POINTS } from "../constants";

export const ProofScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const headerIn = interpolate(frame, [0, 22], [0, 1], {
    extrapolateRight: "clamp",
  });
  const headerY = interpolate(frame, [0, 22], [16, 0], {
    extrapolateRight: "clamp",
  });

  const cardsStart = 28;
  const cardStagger = 26;

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
          gap: 64,
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
              fontSize: 20,
              letterSpacing: 8,
              color: COLORS.accent,
              fontWeight: 600,
            }}
          >
            RESULTS IN THE WILD
          </div>
          <div
            style={{
              fontSize: 80,
              fontWeight: 700,
              letterSpacing: -0.5,
              color: COLORS.ink,
              textAlign: "center",
            }}
          >
            Proof, not promises.
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${PROOF_POINTS.length}, 1fr)`,
            gap: 36,
            width: "100%",
            maxWidth: 1680,
          }}
        >
          {PROOF_POINTS.map((p, i) => {
            const start = cardsStart + i * cardStagger;
            const s = spring({
              frame: frame - start,
              fps,
              config: { damping: 18, stiffness: 90, mass: 0.7 },
            });
            const opacity = interpolate(frame, [start, start + 18], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
            const y = interpolate(s, [0, 1], [40, 0]);

            return (
              <div
                key={i}
                style={{
                  opacity,
                  transform: `translateY(${y}px)`,
                  padding: "48px 36px",
                  border: `1px solid ${COLORS.rule}`,
                  background:
                    "linear-gradient(180deg, rgba(21,32,51,0.55), rgba(7,11,20,0.65))",
                  display: "flex",
                  flexDirection: "column",
                  gap: 16,
                  alignItems: "flex-start",
                  minHeight: 360,
                }}
              >
                <div
                  style={{
                    fontSize: 128,
                    lineHeight: 1,
                    fontWeight: 800,
                    letterSpacing: -2,
                    color: COLORS.accentBright,
                    textShadow: `0 0 40px rgba(232,184,106,0.25)`,
                  }}
                >
                  {p.value}
                </div>
                <div
                  style={{
                    width: 56,
                    height: 2,
                    background: COLORS.accent,
                  }}
                />
                <div
                  style={{
                    fontSize: 22,
                    letterSpacing: 5,
                    color: COLORS.ink,
                    fontWeight: 700,
                  }}
                >
                  {p.unit}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    color: COLORS.inkDim,
                    lineHeight: 1.4,
                  }}
                >
                  {p.caption}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
