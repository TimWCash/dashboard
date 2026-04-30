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

export const CtaScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const markSpring = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 90, mass: 0.7 },
  });
  const markScale = interpolate(markSpring, [0, 1], [0.6, 1]);

  const headlineIn = interpolate(frame, [12, 36], [0, 1], {
    extrapolateRight: "clamp",
  });
  const headlineY = interpolate(frame, [12, 36], [24, 0], {
    extrapolateRight: "clamp",
  });

  const boothIn = interpolate(frame, [40, 70], [0, 1], {
    extrapolateRight: "clamp",
  });
  const boothScale = interpolate(frame, [40, 70], [0.92, 1], {
    extrapolateRight: "clamp",
  });

  const subIn = interpolate(frame, [70, 96], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Fade tail to nothing so the loop returns cleanly to the dark opener.
  const tail = interpolate(
    frame,
    [durationInFrames - 30, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        opacity: tail,
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
        <div style={{ transform: `scale(${markScale})` }}>
          <Mark size={96} />
        </div>

        <div
          style={{
            opacity: headlineIn,
            transform: `translateY(${headlineY}px)`,
            fontSize: 84,
            fontWeight: 700,
            letterSpacing: -0.5,
            textAlign: "center",
            color: COLORS.ink,
            maxWidth: 1500,
            lineHeight: 1.05,
          }}
        >
          Talk to the Service Physics team.
        </div>

        <div
          style={{
            opacity: boothIn,
            transform: `scale(${boothScale})`,
            display: "flex",
            alignItems: "center",
            gap: 24,
            padding: "20px 40px",
            border: `1px solid ${COLORS.accent}`,
            background: "rgba(232,184,106,0.08)",
            boxShadow: `0 0 40px rgba(232,184,106,0.15)`,
          }}
        >
          <span
            style={{
              fontSize: 22,
              letterSpacing: 6,
              color: COLORS.accentBright,
              fontWeight: 600,
            }}
          >
            VISIT US AT
          </span>
          <span
            style={{
              fontSize: 44,
              letterSpacing: 4,
              color: COLORS.ink,
              fontWeight: 800,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            BOOTH {BRAND.booth}
          </span>
        </div>

        <div
          style={{
            opacity: subIn,
            display: "flex",
            alignItems: "center",
            gap: 32,
            marginTop: 12,
          }}
        >
          <span
            style={{
              fontSize: 22,
              letterSpacing: 4,
              color: COLORS.inkDim,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            {BRAND.url.toUpperCase()}
          </span>
          <span style={{ color: COLORS.rule }}>|</span>
          <span
            style={{
              fontSize: 22,
              letterSpacing: 4,
              color: COLORS.inkDim,
              fontWeight: 600,
            }}
          >
            {BRAND.event.toUpperCase()}
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
};
