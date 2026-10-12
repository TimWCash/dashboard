# SplitCab website

splitcab.ie: the landing page plus the static pages the app stores require.

| Path | What it is |
|---|---|
| `src/App.tsx` | The landing page: hero, how it works, why SplitCab, the fee, questions. Links to the live demo. |
| `src/components/ui/` | shadcn/ui components: `button.tsx` and `hero-1.tsx` |
| `public/privacy.html`, `terms.html`, `support.html`, `delete-account.html` | Plain HTML pages, copied as they are. The app and store listings link to `/privacy`, `/terms`, `/support` and `/delete-account`. |
| `public/screens/` | App screenshots used on the landing page |

React, TypeScript, Vite and Tailwind CSS 4, set up for shadcn/ui (`components.json`). Add more shadcn components with `npx shadcn@latest add <name>` from this folder; they land in `src/components/ui`, which is where shadcn components import each other from (`@/components/ui/...`), so keep them there.

```bash
npm run dev -w @splitcab/site      # http://localhost:5173
npm run build -w @splitcab/site    # static files in apps/site/dist
```

Deploy `dist` to any static host that serves `privacy.html` at `/privacy` and so on. On Vercel, create a project with its root directory set to `splitcab/apps/site`; `vercel.json` handles the rest. The page loads nothing from other sites: no fonts, analytics or trackers.

**The privacy policy and terms are drafts.** Have a solicitor review them and fill in every highlighted placeholder (company name, address, CRO number, contact addresses, dates, store links) before publishing.
