# Development helpers

Not part of the application. Excluded from linting and the production build.

| Script | Purpose |
|---|---|
| `screenshots.mjs` | Capture every page on desktop and mobile, for visual review.<br>`node scripts/dev/screenshots.mjs [baseUrl] [ROLE]` |
| `gen-metrics-doc.mjs` | Regenerate `docs/metrics.md` from the definitions in code.<br>`npx tsx scripts/dev/gen-metrics-doc.mjs` |
| `probe-demo.ts` | Print the demo dataset's shape and totals, to sanity-check its realism.<br>`npx tsx scripts/dev/probe-demo.ts` |
| `probe-tools.ts` | Exercise the AI query tools and their permission gates without calling the model.<br>`npx tsx scripts/dev/probe-tools.ts` |

`screenshots.mjs` writes to `scripts/dev/screens/`, which is git-ignored.
