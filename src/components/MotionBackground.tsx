import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../constants";

// Subtle, loopable motion background:
//  - slowly drifting radial glow
//  - faint engineering grid
//  - thin diagonal sheen pass
// All motion is sin/cos based on frame so it loops cleanly.
export const MotionBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();

  const t = (frame / durationInFrames) * Math.PI * 2;

  const glowX = width / 2 + Math.cos(t) * 280;
  const glowY = height / 2 + Math.sin(t * 0.7) * 160;

  // Diagonal sheen sweeps across once per loop.
  const sheenProgress = (frame / durationInFrames) % 1;
  const sheenX = -width + sheenProgress * width * 2.2;

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {/* Base gradient */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(1400px 900px at 50% 35%, ${COLORS.bgMid} 0%, ${COLORS.bgDeep} 65%, #04060c 100%)`,
        }}
      />

      {/* Drifting accent glow */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(600px 600px at ${glowX}px ${glowY}px, rgba(232,184,106,0.10) 0%, rgba(232,184,106,0) 70%)`,
          mixBlendMode: "screen",
        }}
      />

      {/* Engineering grid */}
      <AbsoluteFill
        style={{
          backgroundImage: `
            linear-gradient(${COLORS.grid} 1px, transparent 1px),
            linear-gradient(90deg, ${COLORS.grid} 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          maskImage:
            "radial-gradient(ellipse at center, black 35%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 35%, transparent 80%)",
          opacity: 0.6,
        }}
      />

      {/* Diagonal sheen pass */}
      <AbsoluteFill
        style={{
          transform: `translateX(${sheenX}px) skewX(-18deg)`,
          width: 320,
          left: 0,
          background:
            "linear-gradient(90deg, transparent 0%, rgba(245,209,153,0.06) 50%, transparent 100%)",
          mixBlendMode: "screen",
          pointerEvents: "none",
        }}
      />

      {/* Soft bottom shadow to anchor type */}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.45) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
