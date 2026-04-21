# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Personal site for Diego Delgado (senior SRE, Barcelona). Astro 4 static build, deployed to Cloudflare Pages. Diego only authors tools and writings — everything else is infra.

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
  lib/            shared helpers (e.g. read-stats.ts)
  styles/global.css  ALL styles. Theme tokens at the top.
scripts/
  prebuild.mjs      unshallows git history for changelog in CI
  generate-og.mjs   incremental OG PNG generator
  new-writing.mjs   scaffold a new writing
  new-tool.mjs      scaffold a new tool
public/og/        generated OG PNGs (tracked — CI cache-hit from clone)
.og-cache/
  manifest.json   tracked (content-hash cache key)
  fonts/          gitignored (re-fetched on first CI run)
```

Two extension points: `src/tools/` (drop a folder) and `src/content/writings/` (drop a markdown). Everything else is plumbing.

## Adding a writing

```
npm run new:writing <slug>
```

- Creates `src/content/writings/<slug>.md` with today's date and `draft: true`.
- Frontmatter schema is enforced by zod at `src/content/config.ts`. Required: `title`, `date` (YYYY-MM-DD), `excerpt`. Optional: `tags`, `draft`.
- `read` (minutes) and `words` are **derived from the markdown body** — do not put them in frontmatter. Logic lives in `src/lib/read-stats.ts` (Astro pages) and is duplicated in `scripts/generate-og.mjs` (OG generator). WPM baseline: 225. Fenced and inline code are stripped before counting.
- Flip `draft: false` when the post is ready. Drafts are filtered out everywhere (home latest strip, writings index, OG generation).
- Verify the post appears on `/writings/` and `/og/<slug>.png` exists after build.

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

Astro's `client:*` directives require static imports — that's why the switch isn't derived from the registry. The registry is meta-only.

## Style conventions

- **Terminal aesthetic**: lowercase everywhere, `$` prompts, `##` for section headers, `// ` for comments/labels, dashed underlines for metadata.
- **Fonts**: JetBrains Mono only. No sans-serif.
- **Theme tokens** at `src/styles/global.css:1` (light + dark). Reference via `var(--fg)`, `var(--bg)`, `var(--muted)`, `var(--dim)`, `var(--accent)`, `var(--card)`, `var(--rule)`.
- **Do not inline `style="…"`** in new code. Add a class to `global.css`. Existing inline styles in `index.astro` are legacy.
- **No CSS frameworks** (no Tailwind, no PostCSS plugins). Hand-rolled, one file.
- **Theme toggle** is a class-less `<script is:inline>` in `Base.astro` + `Shell.astro`, runs pre-paint to avoid FOUC. Don't replace with a framework.

## Responsive

- Single breakpoint: `@media (max-width: 560px)` at `src/styles/global.css:446`.
- Every grid/row layout must collapse cleanly at that width.
- **Mandatory after any UI change**: Playwright-screenshot at 375 × 812 (mobile) and 1280 × 800 (desktop) against `npm run dev` (port 4321).

## Playwright MCP

Installed, but on Arch Linux the default `chrome` channel fails (looks at `/opt/google/chrome/chrome`). The MCP must be registered with `--browser chromium` so it uses the bundled chromium-1217 binary:

**Screenshot location**: when taking MCP screenshots (e.g. `browser_take_screenshot`), always pass an absolute `filename` under `/tmp/` (e.g. `/tmp/tool-desktop.png`) so PNGs don't litter the repo root. Never commit screenshots.


```
claude mcp add playwright -- npx -y @playwright/mcp@latest --browser chromium
```

Fallback when the MCP still misbehaves: write a one-off Node script against `playwright` (under `~/.npm/_npx/.../node_modules/playwright`) and point `executablePath` at `~/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome`.

## External services & build-time git

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
- **Changelog** → `src/pages/changelog.astro` reads `git log` at build time. `scripts/prebuild.mjs` runs `git fetch --unshallow` when CI clones shallowly.
- **Footer "last deploy"** → `src/layouts/Shell.astro` frontmatter runs `git log -1 --format=%ad --date=short` at build time. Falls back to today's date if git is unavailable. No constant to maintain in `site.ts`.

## OG images (incremental)

`scripts/generate-og.mjs` runs at prebuild. Behavior:

- Hashes each post's OG-visible fields (slug, title, date, read, words + `SCHEMA_VERSION`) against `.og-cache/manifest.json`.
- Regenerates only posts whose hash changed or whose PNG is missing.
- Fonts (JetBrains Mono 400 + 600) cached at `.og-cache/fonts/` after first fetch.
- Output lives in `public/og/<slug>.png`; Astro copies it to `dist/og/`. Existing URL references (`/og/<slug>.png`) in `Base.astro` and `writings/[slug].astro` stay as-is.
- Manifest + PNGs are **tracked in git** so Cloudflare Pages sees them at clone time and skips regeneration. Only fonts re-fetch on first CI run.
- To **force a full rebuild**: bump `SCHEMA_VERSION` at the top of `scripts/generate-og.mjs`, or delete `.og-cache/manifest.json` + `public/og/`.
- The font preconnect hints in `Base.astro` are for the runtime UI, not OG — leave them.

## Commands

```
npm run dev                # astro dev on :4321
npm run build              # prebuild (git + OG) then astro build
npm run preview            # preview the built site
npm run astro check        # typecheck (no test suite in this repo)
npm run new:writing <slug>
npm run new:tool <slug> "<title>" "<blurb>"
```

## What NOT to do

- **No analytics, trackers, cookies, or login.** Ever.
- **No framework deps for UI** beyond Preact. No React, no Tailwind, no UI libraries.
- **Don't add `tools`, `writings`, or other content arrays to `src/data/site.ts`** — tools come from the registry, writings from the content collection. Keep `site.ts` for constants only.
- **Don't re-introduce `src/pages/og/[slug].png.ts`**. OG is prebuild-generated into `public/og/` now.
- **Don't hardcode dates** (last deploy, now section dates etc.) when a build-time `git log` or `new Date()` would do.
