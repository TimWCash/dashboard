# Service Physics — Conference Promo (Remotion)

A 60-second, loopable, 1920×1080 promo built in [Remotion](https://github.com/remotion-dev/remotion) for playback on a large TV at a conference booth.

## Running

```bash
npm install
npm start              # opens Remotion Studio
npm run build          # renders out/service-physics-promo.mp4
```

## Composition

| Scene | Length | Purpose |
| --- | --- | --- |
| `LogoScene` | 8s | Service Physics mark + wordmark |
| `TaglineScene` | 8s | "Make service work better for people." |
| `EventScene` | 8s | Conference / event presence |
| `ProblemsScene` | 12s | Client problem statements |
| `WhatWeDoScene` | 16s | Observation · Process Design · Throughput · Waste Reduction |
| `CtaScene` | 8s | "Visit us at booth ___" / "Talk to the team" |

The motion background drifts over a full loop period, and the CTA fades to the same deep navy that opens the LogoScene — so the video loops cleanly on the booth display.

## File layout

```
src/
  index.ts                # Remotion entry
  Root.tsx                # Composition registry
  ConferencePromo.tsx     # Top-level composition (sequences + chrome)
  constants.ts            # All editable copy, colors, timings
  components/
    MotionBackground.tsx  # Loopable subtle background
    Vignette.tsx
    FrameChrome.tsx       # Persistent wordmark + URL + booth label + Mark
    AnimatedWord.tsx      # Per-word stagger animation
  scenes/
    LogoScene.tsx
    TaglineScene.tsx
    EventScene.tsx
    ProblemsScene.tsx
    WhatWeDoScene.tsx
    CtaScene.tsx
```

## Editing copy, colors, booth number

Open `src/constants.ts`. Everything that changes per event lives there:

- `BRAND` — name, tagline, URL, booth, event
- `COLORS` — palette (deep navy + gold accent by default)
- `TYPE` — font stacks
- `SCENES` — section ordering and durations (must sum to total length)
- `PROBLEMS` — pain-point lines
- `CAPABILITIES` — the four "what we do" cards
