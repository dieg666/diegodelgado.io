#!/usr/bin/env node
// Incremental OG image generator.
//
// Reads src/content/writings/*.md, renders one PNG per post (plus a default),
// and only regenerates what changed. State lives in .og-cache/manifest.json;
// fonts are cached under .og-cache/fonts/ so Google Fonts is hit at most once.
//
// Bump SCHEMA_VERSION below to invalidate every entry (e.g. after a layout
// change to the OG template).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const SCHEMA_VERSION = 1;

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const writingsDir = join(root, "src/content/writings");
const outDir = join(root, "public/og");
const cacheDir = join(root, ".og-cache");
const fontsDir = join(cacheDir, "fonts");
const manifestPath = join(cacheDir, "manifest.json");

const site = {
  name: "diego delgado",
  role: "senior sre",
  domain: "diegodelgado.io",
};

function splitFrontmatter(md) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: md };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    else if (v === "true") v = true;
    else if (v === "false") v = false;
    fm[kv[1]] = v;
  }
  return { fm, body: m[2] };
}

// Keep in sync with src/lib/read-stats.ts.
const WORDS_PER_MINUTE = 225;
function readStats(body) {
  const stripped = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<[^>]+>/g, " ");
  const words = stripped.split(/\s+/).filter(Boolean).length;
  const read = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return { read, words };
}

function listPosts() {
  if (!existsSync(writingsDir)) return [];
  return readdirSync(writingsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      const { fm, body } = splitFrontmatter(readFileSync(join(writingsDir, f), "utf8"));
      const { read, words } = readStats(body);
      return {
        slug,
        title: fm.title ?? slug,
        date: fm.date ?? "",
        read,
        words,
        draft: fm.draft ?? false,
      };
    })
    .filter((p) => !p.draft);
}

function hashEntry(entry) {
  const h = createHash("sha256");
  h.update(String(SCHEMA_VERSION));
  h.update("\0");
  for (const k of ["slug", "title", "date", "read", "words"]) {
    h.update(String(entry[k] ?? ""));
    h.update("\0");
  }
  h.update(site.role);
  h.update("\0");
  h.update(site.domain);
  return h.digest("hex");
}

async function fetchFont(weight) {
  const file = join(fontsDir, `jetbrains-mono-${weight}.ttf`);
  if (existsSync(file)) return readFileSync(file);
  console.log(`[og] fetching JetBrains Mono ${weight} from Google Fonts`);
  const cssUrl = `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@${weight}&display=swap`;
  const css = await fetch(cssUrl, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.text());
  const m = css.match(/src: url\((.+?)\) format/);
  if (!m) throw new Error(`JetBrains Mono ${weight} font URL not found`);
  const buf = Buffer.from(await fetch(m[1]).then((r) => r.arrayBuffer()));
  mkdirSync(fontsDir, { recursive: true });
  writeFileSync(file, buf);
  return buf;
}

function buildMarkup(entry, kind) {
  const bg = "#f5f2ec";
  const fg = "#1c1b19";
  const dim = "#6b6963";
  const accent = "#8a3a1f";

  const headline = kind === "post" ? entry.title : "diegodelgado.io";
  const meta =
    kind === "post" ? `## writings / ${entry.date}` : "## senior sre · barcelona";
  const footLeft = `${site.name} · ${site.role}`;
  const footRight =
    kind === "post"
      ? `${entry.read} min · ${Number(entry.words).toLocaleString()} words`
      : site.domain;

  return {
    type: "div",
    props: {
      style: {
        width: "1200px",
        height: "630px",
        background: bg,
        color: fg,
        fontFamily: "JetBrains Mono",
        padding: "48px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      },
      children: [
        {
          type: "div",
          props: {
            style: { display: "flex", gap: "10px", fontSize: "18px", alignItems: "center" },
            children: [
              { type: "span", props: { style: { color: accent }, children: "❯" } },
              { type: "span", props: { style: { color: dim }, children: site.domain } },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column" },
            children: [
              {
                type: "div",
                props: { style: { color: accent, fontSize: "22px", marginBottom: "18px" }, children: meta },
              },
              {
                type: "div",
                props: {
                  style: {
                    fontSize: "60px",
                    fontWeight: 600,
                    letterSpacing: "-1.4px",
                    lineHeight: 1.1,
                    maxWidth: "92%",
                  },
                  children: headline,
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              justifyContent: "space-between",
              fontSize: "20px",
              color: dim,
              borderTop: `1px solid ${dim}33`,
              paddingTop: "18px",
            },
            children: [
              { type: "span", props: { children: footLeft } },
              { type: "span", props: { children: footRight } },
            ],
          },
        },
      ],
    },
  };
}

async function render(entry, kind, fonts) {
  const svg = await satori(buildMarkup(entry, kind), {
    width: 1200,
    height: 630,
    fonts: [
      { name: "JetBrains Mono", data: fonts[400], weight: 400, style: "normal" },
      { name: "JetBrains Mono", data: fonts[600], weight: 600, style: "normal" },
    ],
  });
  return new Resvg(svg).render().asPng();
}

function loadManifest() {
  if (!existsSync(manifestPath)) return {};
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return {};
  }
}

function saveManifest(m) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(m, null, 2));
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  const posts = listPosts();
  const entries = [
    ...posts.map((p) => ({ ...p, _kind: "post" })),
    { slug: "default", title: "diegodelgado.io", date: "", read: 0, words: 0, _kind: "default" },
  ];

  const manifest = loadManifest();
  const nextManifest = {};
  const todo = [];

  for (const e of entries) {
    const hash = hashEntry(e);
    nextManifest[e.slug] = hash;
    const outPath = join(outDir, `${e.slug}.png`);
    if (manifest[e.slug] === hash && existsSync(outPath)) continue;
    todo.push(e);
  }

  // Remove stale entries.
  const liveSlugs = new Set(entries.map((e) => e.slug));
  for (const slug of Object.keys(manifest)) {
    if (!liveSlugs.has(slug)) {
      const stale = join(outDir, `${slug}.png`);
      if (existsSync(stale)) rmSync(stale);
    }
  }

  if (todo.length === 0) {
    console.log(`[og] 0 regenerated (${entries.length} up to date)`);
    saveManifest(nextManifest);
    return;
  }

  console.log(`[og] regenerating ${todo.length} of ${entries.length}`);
  const [f400, f600] = await Promise.all([fetchFont(400), fetchFont(600)]);
  const fonts = { 400: f400, 600: f600 };

  for (const e of todo) {
    const png = await render(e, e._kind, fonts);
    writeFileSync(join(outDir, `${e.slug}.png`), png);
    console.log(`[og]   ${e.slug}.png`);
  }

  saveManifest(nextManifest);
}

main().catch((err) => {
  console.error("[og] failed:", err);
  process.exit(1);
});
