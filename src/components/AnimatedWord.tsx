import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

// Splits a string into words and animates each in with a soft spring rise.
export const AnimatedWords: React.FC<{
  text: string;
  startFrame?: number;
  stagger?: number;
  style?: React.CSSProperties;
  wordStyle?: React.CSSProperties;
}> = ({ text, startFrame = 0, stagger = 4, style, wordStyle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = text.split(" ");

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "0.35em",
        ...style,
      }}
    >
      {words.map((word, i) => {
        const localFrame = frame - startFrame - i * stagger;
        const progress = spring({
          frame: localFrame,
          fps,
          config: { damping: 18, stiffness: 110, mass: 0.6 },
        });
        const opacity = interpolate(localFrame, [0, 12], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const y = interpolate(progress, [0, 1], [40, 0]);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateY(${y}px)`,
              opacity,
              ...wordStyle,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
};
