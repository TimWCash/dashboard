import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CLIENTS, COLORS } from "../constants";

// Client logos scene.
// Logos render either as an image (if logoUrl is set in constants) or as a
// typeset wordmark fallback so the video still looks complete pre-asset-drop.
// The grid drifts horizontally + breathes slightly, so it never feels static
// across a 4-day loop.
export const ClientsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();

  const headerIn = interpolate(frame, [0, 22], [0, 1], {
    extrapolateRight: "clamp",
  });
  const headerY = interpolate(frame, [0, 22], [16, 0], {
    extrapolateRight: "clamp",
  });

  const gridIn = interpolate(frame, [22, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Subtle horizontal drift so the wall never feels frozen.
  const drift = interpolate(
    frame,
    [0, durationInFrames],
    [-30, 30],
  );

  const outOpacity = interpolate(
    frame,
    [durationInFrames - 28, durationInFrames - 5],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Choose grid columns based on count — keeps cells wide enough for
  // typeset wordmarks to read without mid-word breaks.
  const cols = CLIENTS.length <= 4 ? CLIENTS.length : 4;

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
            TRUSTED BY OPERATORS
          </div>
          <div
            style={{
              fontSize: 72,
              fontWeight: 700,
              letterSpacing: -0.5,
              color: COLORS.ink,
              textAlign: "center",
              lineHeight: 1.1,
            }}
          >
            Brands that take service seriously.
          </div>
        </div>

        <div
          style={{
            opacity: gridIn,
            transform: `translateX(${drift}px)`,
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 36,
            width: "100%",
            maxWidth: 1680,
          }}
        >
          {CLIENTS.map((client, i) => {
            const cellStart = 28 + i * 6;
            const cellOpacity = interpolate(
              frame,
              [cellStart, cellStart + 24],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );
            const cellY = interpolate(
              frame,
              [cellStart, cellStart + 24],
              [16, 0],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            );

            return (
              <div
                key={i}
                style={{
                  opacity: cellOpacity,
                  transform: `translateY(${cellY}px)`,
                  height: 200,
                  border: `1px solid ${COLORS.rule}`,
                  background:
                    "linear-gradient(180deg, rgba(245,247,251,0.05), rgba(245,247,251,0.02))",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 32,
                }}
              >
                {client.logoUrl ? (
                  <Img
                    src={
                      client.logoUrl.startsWith("http")
                        ? client.logoUrl
                        : staticFile(client.logoUrl)
                    }
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      objectFit: "contain",
                      filter: "brightness(0) invert(1)",
                      opacity: 0.92,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      fontSize: 32,
                      fontWeight: 700,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                      color: COLORS.ink,
                      textAlign: "center",
                      lineHeight: 1.15,
                    }}
                  >
                    {client.name}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
