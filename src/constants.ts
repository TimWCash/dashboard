// All editable copy, colors, and timing live here.
// Tweak these without touching component code.

export const BRAND = {
  name: "SERVICE PHYSICS",
  tagline: "Make service work better for people.",
  url: "servicephysics.com",
  booth: "B-214",
  event: "Service Innovation Summit 2026",
};

export const COLORS = {
  // Deep, premium consulting palette.
  bgDeep: "#070b14",
  bgMid: "#0e1726",
  bgSoft: "#152033",
  ink: "#f5f7fb",
  inkDim: "rgba(245, 247, 251, 0.72)",
  inkFaint: "rgba(245, 247, 251, 0.42)",
  // Signature gold accent — used sparingly.
  accent: "#e8b86a",
  accentBright: "#f5d199",
  accentDeep: "#a47a3a",
  rule: "rgba(232, 184, 106, 0.35)",
  grid: "rgba(245, 247, 251, 0.05)",
};

export const TYPE = {
  display: "Inter, system-ui, sans-serif",
  body: "Inter, system-ui, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

// 60s @ 30fps = 1800 frames. Section durations sum to 1800.
// Adjust freely; total length recalculates from this list.
export const SCENES: Array<{ id: string; durationInFrames: number }> = [
  { id: "logo", durationInFrames: 240 },        //  0–240   ( 0–8s )
  { id: "tagline", durationInFrames: 240 },     //  240–480 ( 8–16s)
  { id: "event", durationInFrames: 240 },       //  480–720 (16–24s)
  { id: "problems", durationInFrames: 360 },    //  720–1080(24–36s)
  { id: "whatWeDo", durationInFrames: 480 },    // 1080–1560(36–52s)
  { id: "cta", durationInFrames: 240 },         // 1560–1800(52–60s)
];

export const TOTAL_FRAMES = SCENES.reduce(
  (sum, s) => sum + s.durationInFrames,
  0,
);

// Copy blocks per section.
export const PROBLEMS = [
  "Long waits. Frustrated customers.",
  "Staff stretched thin.",
  "Bottlenecks no one can see.",
  "Processes that fight your team.",
];

export const CAPABILITIES = [
  {
    kicker: "01",
    title: "Observation",
    body: "We watch your service in motion — what people actually do, not what the org chart says.",
  },
  {
    kicker: "02",
    title: "Process Design",
    body: "We redesign flows so the easy path is the right path, for staff and customers alike.",
  },
  {
    kicker: "03",
    title: "Throughput",
    body: "We unblock the constraints that cap your capacity — without burning out your team.",
  },
  {
    kicker: "04",
    title: "Waste Reduction",
    body: "We strip friction, rework, and idle time from every interaction that touches a customer.",
  },
];
