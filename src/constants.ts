// All editable copy, colors, and timing live here.
// Tweak these without touching component code.
// Anything labeled PLACEHOLDER is meant to be swapped before showtime.

export const BRAND = {
  name: "SERVICE PHYSICS",
  tagline: "Make service work better for people.",
  url: "servicephysics.com",
  booth: "BOOTH #7365",
  event: "NRA Show 2026",
  eventLong: "National Restaurant Association Show · Chicago",
};

export const COLORS = {
  // Service Physics brand palette — derived from the real logo and
  // the booth-wall artwork (deep navy-teal + bright sea-teal).
  bgDeep: "#051821",
  bgMid: "#0a2731",
  bgSoft: "#10394a",
  ink: "#f4f7f7",
  inkDim: "rgba(244, 247, 247, 0.72)",
  inkFaint: "rgba(244, 247, 247, 0.42)",
  // Bright teal accent replaces the prior gold.
  accent: "#2da89e",
  accentBright: "#5dc4b8",
  accentDeep: "#115a6e",
  rule: "rgba(45, 168, 158, 0.35)",
  grid: "rgba(244, 247, 247, 0.05)",
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

// Proof points — keep `value` short (≤6 chars) for the headline layout.
// First card uses a verified figure cited by Service Physics for Peet's;
// the other two are framed against the broader portfolio — replace with
// the specific outcomes you most want highlighted on the back wall.
export const PROOF_POINTS: Array<{
  value: string;
  unit: string;
  caption: string;
}> = [
  {
    value: "$12.9M",
    unit: "REVENUE UNLOCKED",
    caption: "annual potential, Peet's Coffee",
  },
  {
    value: "12",
    unit: "BRAND PARTNERS",
    caption: "QSR, fast casual & coffee",
  },
  {
    value: "Lean",
    unit: "+ KAIZEN",
    caption: "embedded in every engagement",
  },
];

// Testimonial pulled from Service Physics' public materials.
export const QUOTE = {
  body: "We can’t have a consultant that isn’t all about people.",
  attribution: "Becky Mulligan · Chief Restaurant Officer, MOD Pizza",
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
  { name: "IHOP" /* , logoUrl: "logos/ihop.png" */ },
  { name: "Krispy Kreme" /* , logoUrl: "logos/krispy-kreme.png" */ },
  { name: "MOD Pizza" /* , logoUrl: "logos/mod-pizza.png" */ },
  { name: "Panda Express" /* , logoUrl: "logos/panda-express.png" */ },
  { name: "Peet's Coffee" /* , logoUrl: "logos/peets-coffee.png" */ },
  { name: "Smashburger" /* , logoUrl: "logos/smashburger.png" */ },
  { name: "Subway" /* , logoUrl: "logos/subway.png" */ },
  { name: "Sweetgreen" /* , logoUrl: "logos/sweetgreen.png" */ },
];
