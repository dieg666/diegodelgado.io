# diegodelgado.io

Personal site for Diego Delgado (senior SRE, Barcelona). Astro 4 static build, Preact islands, deployed to Cloudflare Pages.

## Development

```
npm run dev                                   # astro dev on :4321
npm run build                                 # prebuild (git + OG) then astro build
npm run new:writing <slug>                    # scaffold a new writing
npm run new:tool <slug> "<title>" "<blurb>"   # scaffold a new tool
```

See [CLAUDE.md](./CLAUDE.md) for the full contributor guide — directory map, style conventions, deploy pipeline, and OG image cache.

## License

This repo is dual-licensed:

- **Code** — [MIT](./LICENSE). Covers everything in `src/` (except `src/content/writings/`), `scripts/`, `public/` (except `public/og/`), and all config files.
- **Content** — [CC BY 4.0](./LICENSE-content). Covers `src/content/writings/*.md` (posts) and `public/og/*.png` (generated OG images). Canonical URL: https://creativecommons.org/licenses/by/4.0/

Reuse of writings is fine under CC BY 4.0 — please credit "Diego Delgado" and link back to the original post.
