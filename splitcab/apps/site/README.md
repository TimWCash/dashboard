# SplitCab website

splitcab.ie: the landing page plus the static pages the app stores require.

| Path | What it is |
|---|---|
| `src/App.tsx` | The landing page: hero, what you'd pay, how it works, why SplitCab, the fee, questions. Links to the live demo. |
| `src/components/fare-estimator.tsx` | "See what you'd pay": pick a pickup, drop-off and time, and see the fare alone and each person's share, from `@splitcab/core`'s fare model at NTA rates. It knows the places in `packages/core/src/places.ts`. |
| `src/components/ui/` | shadcn/ui components: `button.tsx`, `hero-1.tsx` and `ride-booking-form.tsx` (the trip form, animated with framer-motion, which respects reduced motion) |
| `public/privacy.html`, `terms.html`, `support.html`, `delete-account.html` | Plain HTML pages, copied as they are. The app and store listings link to `/privacy`, `/terms`, `/support` and `/delete-account`. |
| `public/screens/` | App screenshots used on the landing page |

React, TypeScript, Vite and Tailwind CSS 4, set up for shadcn/ui (`components.json`). Add more shadcn components with `npx shadcn@latest add <name>` from this folder; they land in `src/components/ui`, which is where shadcn components import each other from (`@/components/ui/...`), so keep them there.

```bash
npm run dev -w @splitcab/site      # http://localhost:5173
npm run build -w @splitcab/site    # static files in apps/site/dist
```

Deploy `dist` to any static host that serves `privacy.html` at `/privacy` and so on. On Vercel, create a project with its root directory set to `splitcab/apps/site`; `vercel.json` handles the rest.

For now it's live at https://splitcab-ie.vercel.app from the demo's Vercel project instead: with `SITE_HOSTS=splitcab-ie.vercel.app`, the demo build (`apps/demo/build.mjs`) also builds this site and serves it to that address. When it gets a project of its own, remove the address and `SITE_HOSTS` from the demo's project first. The page loads nothing from other sites: no fonts, analytics or trackers.

**The privacy policy and terms name Tim Cashman as running SplitCab**, with a personal contact address, until a company exists. They haven't been reviewed by a solicitor yet. Once the company is registered, replace the name with its legal name, registered address and CRO number, and change the date at the top of each page you edit.
