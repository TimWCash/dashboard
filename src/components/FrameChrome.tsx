import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { BRAND, COLORS, SCENES } from "../constants";

// The persistent chrome that sits above scenes:
// thin rules, small wordmark + URL, event tag, and a prominent booth chip.
// On a back-wall loop people only glance — so chrome stays visible the
// entire run except for a brief fade-in over the opening logo flourish
// and a fade-out tail at the very end so the CTA owns the frame.
export const FrameChrome: React.FC = () => {
  const frame = useCurrentFrame();
  const logoOut = SCENES[0].durationInFrames; // when intro logo ends
  const total = SCENES.reduce((s, x) => s + x.durationInFrames, 0);

  const inOpacity = interpolate(
    frame,
    [logoOut - 30, logoOut + 10],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const outOpacity = interpolate(
    frame,
    [total - 60, total - 20],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(inOpacity, outOpacity);

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity }}>
      {/* Top hairline */}
      <div
        style={{
          position: "absolute",
          top: 56,
          left: 80,
          right: 80,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${COLORS.rule} 20%, ${COLORS.rule} 80%, transparent)`,
        }}
      />

      {/* Top-left wordmark */}
      <div
        style={{
          position: "absolute",
          top: 80,
          left: 80,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <Mark size={22} />
        <span
          style={{
            fontSize: 18,
            letterSpacing: 4,
            fontWeight: 600,
            color: COLORS.ink,
          }}
        >
          {BRAND.name}
        </span>
      </div>

      {/* Top-right URL */}
      <div
        style={{
          position: "absolute",
          top: 84,
          right: 80,
          fontSize: 16,
          letterSpacing: 3,
          color: COLORS.inkDim,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {BRAND.url.toUpperCase()}
      </div>

      {/* Bottom hairline */}
      <div
        style={{
          position: "absolute",
          bottom: 56,
          left: 80,
          right: 80,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${COLORS.rule} 20%, ${COLORS.rule} 80%, transparent)`,
        }}
      />

      {/* Bottom-left event */}
      <div
        style={{
          position: "absolute",
          bottom: 78,
          left: 80,
          fontSize: 14,
          letterSpacing: 4,
          color: COLORS.inkFaint,
        }}
      >
        {BRAND.event.toUpperCase()}
      </div>

      {/* Bottom-right tag */}
      <div
        style={{
          position: "absolute",
          bottom: 78,
          right: 80,
          fontSize: 14,
          letterSpacing: 4,
          color: COLORS.inkFaint,
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        BOOTH {BRAND.booth}
      </div>
    </AbsoluteFill>
  );
};

// Service Physics "S" mark.
// PLACEHOLDER: clean blocky angular S in the brand teal. The real
// logo is two interlocking two-tone pieces — for pixel-perfect output
// drop the official file into public/brand/logo.svg and swap this
// component's body for:
//   <Img src={staticFile("brand/logo.svg")} ... />
export const Mark: React.FC<{ size?: number }> = ({ size = 64 }) => {
  return (
    <svg
      width={(size * 32) / 48}
      height={size}
      viewBox="0 0 32 48"
      fill="none"
      style={{ display: "block" }}
    >
      <path
        d="M 4 4
           L 28 4
           L 28 16
           L 14 16
           L 14 22
           L 28 22
           L 28 44
           L 4 44
           L 4 32
           L 18 32
           L 18 26
           L 4 26
           Z"
        fill={COLORS.ink}
      />
    </svg>
  );
};
