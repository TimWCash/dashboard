// All editable copy, colors, and timing live here.
// Tweak these without touching component code.
// Anything labeled PLACEHOLDER is meant to be swapped before showtime.

export const BRAND = {
  name: "SERVICE PHYSICS",
  tagline: "Make service work better for people.",
  url: "servicephysics.com",
  // PLACEHOLDER — swap in actual booth number for NRA Show 2026.
  booth: "BOOTH #####",
  event: "NRA Show 2026",
  eventLong: "National Restaurant Association Show · Chicago",
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

// 120s @ 30fps = 3600 frames. Section durations sum to 3600.
// Adjust freely; total length recalculates from this list.
// Order is tuned so that any 30s window on the loop catches:
//   brand, a value prop, and proof or CTA.
export const SCENES: Array<{ id: string; durationInFrames: number }> = [
  { id: "logo", durationInFrames: 240 },        //   0– 240 (  0– 8s)
  { id: "tagline", durationInFrames: 300 },     // 240– 540 (  8–18s)
  { id: "problems", durationInFrames: 480 },    // 540–1020 ( 18–34s)
  { id: "quote", durationInFrames: 420 },       //1020–1440 ( 34–48s)
  { id: "whatWeDo", durationInFrames: 600 },    //1440–2040 ( 48–68s)
  { id: "proof", durationInFrames: 480 },       //2040–2520 ( 68–84s)
  { id: "clients", durationInFrames: 540 },     //2520–3060 ( 84–102s)
  { id: "event", durationInFrames: 240 },       //3060–3300 (102–110s)
  { id: "cta", durationInFrames: 300 },         //3300–3600 (110–120s)
];

export const TOTAL_FRAMES = SCENES.reduce(
  (sum, s) => sum + s.durationInFrames,
  0,
);

// Restaurant-industry framed pain points for an NRA Show audience.
export const PROBLEMS = [
  "Drive-thru lines that won’t move.",
  "Labor stretched thin at peak.",
  "Stations fighting each other.",
  "Guest experience uneven store to store.",
];

export const CAPABILITIES = [
  {
    kicker: "01",
    title: "Observation",
    body: "We watch service in motion — what your team actually does, not what the playbook says.",
  },
  {
    kicker: "02",
    title: "Process Design",
    body: "We redesign flows so the easy path is the right path, for crew and guests alike.",
  },
  {
    kicker: "03",
    title: "Throughput",
    body: "We unblock the constraints that cap peak capacity — without burning out the team.",
  },
  {
    kicker: "04",
    title: "Waste Reduction",
    body: "We strip friction, rework, and idle time from every interaction that touches a guest.",
  },
];

// PLACEHOLDER proof points — replace with real client outcomes.
// Keep `value` short (3–5 chars) and `unit` in caps for the layout.
export const PROOF_POINTS: Array<{
  value: string;
  unit: string;
  caption: string;
}> = [
  { value: "+18%", unit: "THROUGHPUT", caption: "at peak hour, drive-thru" },
  { value: "−4 min", unit: "AVG WAIT", caption: "front-of-house lines" },
  { value: "120+", unit: "OPERATORS", caption: "served across QSR & casual" },
];

// PLACEHOLDER testimonial. Swap in a real operator quote before showtime.
export const QUOTE = {
  body:
    "Service Physics changed how we think about every minute of our peak.",
  attribution: "VP of Operations · [PLACEHOLDER CLIENT]",
};

// Client logos shown in the Clients scene.
// Two ways to populate each entry:
//   • { name }                        → typeset wordmark in the brand style
//   • { name, logoUrl: "logos/x.png"} → render the actual logo image
//
// To use real logos, drop PNG/SVG files into `public/logos/` with the
// filenames below and uncomment the `logoUrl` lines.
export const CLIENTS: Array<{ name: string; logoUrl?: string }> = [
  { name: "Applebee's" /* , logoUrl: "logos/applebees.png" */ },
  { name: "CAVA" /* , logoUrl: "logos/cava.png" */ },
  { name: "Dave's Hot Chicken" /* , logoUrl: "logos/daves-hot-chicken.png" */ },
  { name: "Fuzzy's Taco Shop" /* , logoUrl: "logos/fuzzys-taco-shop.png" */ },
];
