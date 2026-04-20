# diegodelgado.io

Personal site for Diego Delgado (senior SRE, Barcelona). Astro 4 static build, deployed to Cloudflare Pages. Diego only authors tools and writings — everything else is infra. These notes are for Claude: read them before making changes.

## Stack

- **Astro 4** (`astro.config.mjs`), static output, `build.format: "directory"`.
- **Preact** via `@astrojs/preact` for interactive islands. No React.
- **MDX** available via `@astrojs/mdx` but writings are plain `.md` today.
- **Shiki** for syntax highlighting (both `github-light` and `github-dark` emitted; CSS picks one).
- **Satori + Resvg** for OG images, run at prebuild (see `scripts/generate-og.mjs`).
- **Deploy**: Cloudflare Pages via `wrangler.jsonc` (assets from `./dist`). No SSR.

## Directory map

```
src/
  layouts/        Base.astro, Shell.astro (terminal chrome + theme toggle)
  pages/          Astro routes
  components/     Non-tool Preact components (e.g. Fortune)
  tools/          Tool registry — one folder per tool (see "Adding a tool")
  content/
    writings/     .md posts (see "Adding a writing")
    config.ts     zod schema for writings frontmatter
  data/site.ts    site-wide constants (name, role, about, bookmarks, fortunes, now)
  styles/global.css  ALL styles. Theme tokens at the top.
scripts/
  prebuild.mjs      unshallows git history for changelog in CI
  generate-og.mjs   incremental OG PNG generator
  new-writing.mjs   scaffold a new writing
  new-tool.mjs      scaffold a new tool
public/og/        generated OG PNGs (gitignored)
.og-cache/        manifest + font cache (gitignored)
```

Two extension points: `src/tools/` (drop a folder) and `src/content/writings/` (drop a markdown). Everything else is plumbing.

## Adding a writing

```
npm run new:writing <slug>
```

- Creates `src/content/writings/<slug>.md` with today's date and `draft: true`.
- Frontmatter schema is enforced by zod at `src/content/config.ts`. Required: `title`, `date` (YYYY-MM-DD), `excerpt`. Optional: `tags`, `draft`.
- `read` (minutes) and `words` are **derived from the markdown body** — do not put them in frontmatter. Logic lives in `src/lib/read-stats.ts` (Astro pages) and is duplicated in `scripts/generate-og.mjs` (OG generator). WPM baseline: 225. Fenced code blocks and inline code are stripped before counting.
- Flip `draft: false` when the post is ready. Drafts are filtered out everywhere (home latest strip, writings index, OG generation).
- The OG image for `<slug>` is generated on the next build into `public/og/<slug>.png`, using the same derived read/words numbers shown on the post.

## Adding a tool

```
npm run new:tool <slug> "<title>" "<blurb>"
```

- Creates `src/tools/<slug>/index.tsx` that exports `meta` only → renders as "coming soon".
- The registry at `src/tools/index.ts` uses `import.meta.glob` with `eager: true`, so new folders appear on `/tools/` and at `/tools/<slug>/` with no edits to `data/site.ts`, `pages/tools/index.astro`, or `pages/tools/[slug].astro`.
- The tool page H1 lowercases the title to match the aesthetic. `meta.title` can be in Title Case.

**Making a tool interactive** (one extra file + one switch branch):

1. In `src/tools/<slug>/index.tsx`, add a default-exported Preact component next to `meta`. Use `preact/hooks`. Model after `src/tools/slo-calculator/index.tsx`.
2. In `src/pages/tools/[slug].astro`, statically import it and add a branch to the switch:
   ```astro
   import BurnRate from "@/tools/burn-rate";
   ...
   {meta.slug === "burn-rate" ? <BurnRate client:load /> : ... }
   ```

Astro's `client:*` directives require static imports (that's why the switch isn't derived from the registry — the registry is meta-only).

## Style conventions

- **Terminal aesthetic**: lowercase everywhere, `$` prompts, `##` for section headers, `// ` for comments/labels, dashed underlines for metadata.
- **Fonts**: JetBrains Mono only. No sans-serif anywhere.
- **Theme tokens** at `src/styles/global.css:1` — light + dark variants. Reference via `var(--fg)`, `var(--bg)`, `var(--muted)`, `var(--dim)`, `var(--accent)`, `var(--card)`, `var(--rule)`.
- **Do not inline `style="…"`** in new code. Add a class to `global.css`. The existing inline styles in `index.astro` are legacy.
- **No frameworks for CSS** (no Tailwind, no PostCSS plugins). Hand-rolled, one file.
- **Theme toggle** is a class-less `<script is:inline>` in `Base.astro` + `Shell.astro`, runs pre-paint to avoid FOUC. Don't replace with a framework.

## Responsive

- Single breakpoint: `@media (max-width: 560px)` at `src/styles/global.css:446`.
- Every grid/row layout must collapse cleanly at that width.
- **Mandatory after any UI change**: Playwright-screenshot at 375 × 812 (mobile) and 1280 × 800 (desktop) against `npm run dev` (port 4321). The Playwright MCP is installed — use it.

## External services

- **`/api/uptime`** → served by a separate repo, **`diegodelgado-uptime`** (Cloudflare Worker). Payload shape:
  ```ts
  {
    status: "ok" | "down" | "unknown";
    uptime_pct: number | null;
    p95_ms: number | null;
    checks: number;
    last_check: { ts: number; ok: boolean; http_status: number; latency_ms: number } | null;
  }
  ```
  Consumed in `src/pages/index.astro`. In local dev the fetch 404s silently and the strip shows `— / unknown` — expected, not a bug.
- **Changelog** → `src/pages/changelog.astro` reads `git log` at build time. `scripts/prebuild.mjs` runs `git fetch --unshallow` when CI clones shallowly. If `git` is unavailable, the page falls back to an empty list.

## OG images (incremental)

`scripts/generate-og.mjs` runs at prebuild. Behavior:

- Hashes each post's OG-visible fields (slug, title, date, read, words + `SCHEMA_VERSION`) against `.og-cache/manifest.json`.
- Regenerates only posts whose hash changed or whose PNG is missing.
- Fonts (JetBrains Mono 400 + 600) cached at `.og-cache/fonts/` after first fetch.
- Output lives in `public/og/<slug>.png`; Astro copies it to `dist/og/`. Existing URL references (`/og/<slug>.png`) in `Base.astro` and `writings/[slug].astro` stay as-is.
- To **force a full rebuild**: bump `SCHEMA_VERSION` at the top of `scripts/generate-og.mjs`, or delete `.og-cache/` + `public/og/`.
- The font preconnect hints in `Base.astro` are for the runtime UI, not OG — leave them.

## Commands

```
npm run dev              # astro dev on :4321
npm run build            # prebuild (git + OG) then astro build
npm run preview          # preview the built site
npm run astro check      # typecheck
npm run new:writing <slug>
npm run new:tool <slug> "<title>" "<blurb>"
```

## Deploy

- Cloudflare Pages picks up `dist/` via `wrangler.jsonc`.
- No SSR, no edge functions in this repo. The uptime API is a separate worker.
- The site is fully static; don't add API routes here without a strong reason.

## What NOT to do

- **No analytics, trackers, cookies, or login**. Ever.
- **No framework deps for UI** beyond Preact. No React, no Tailwind, no UI libraries.
- **No refactor beyond task scope**. Inherits from `~/.claude/CLAUDE.md`: three similar lines beats a premature abstraction.
- **No comments that restate code**. Only WHY comments for non-obvious invariants.
- **No commits or pushes without explicit permission**. Inherits from `~/.claude/CLAUDE.md`.
- **Don't add `tools`, `writings`, or other content arrays to `src/data/site.ts`** — tools come from the registry, writings from the content collection. Keep `site.ts` for constants only.
- **Don't re-introduce `src/pages/og/[slug].png.ts`**. OG is prebuild-generated into `public/og/` now.

## Post-change checklist

- [ ] `npm run astro check` is clean.
- [ ] `npm run build` succeeds (watch for `[og] N regenerated` — N should be small if you didn't touch writings).
- [ ] Playwright screenshot at 375 × 812 and 1280 × 800 for any UI-touching change.
- [ ] New tool → appears on `/tools/`, `/tools/<slug>/` renders, lowercase H1.
- [ ] New writing → appears on `/writings/`, shows on home if in latest 4, `/og/<slug>.png` exists.
