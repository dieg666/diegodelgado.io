import type { APIRoute } from "astro";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { getCollection, type CollectionEntry } from "astro:content";
import { site } from "@/data/site";

type Writing = CollectionEntry<"writings">;

async function loadFont(weight: 400 | 600): Promise<ArrayBuffer> {
  const url = `https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@${weight}&display=swap`;
  const css = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => r.text());
  const m = css.match(/src: url\((.+?)\) format/);
  if (!m) throw new Error("JetBrains Mono font URL not found");
  return await fetch(m[1]).then((r) => r.arrayBuffer());
}

export async function getStaticPaths() {
  const posts = await getCollection("writings", ({ data }) => !data.draft);
  return [
    ...posts.map((p) => ({ params: { slug: p.slug }, props: { post: p } })),
    { params: { slug: "default" }, props: { post: null } },
  ];
}

export const GET: APIRoute = async ({ props }) => {
  const post = (props as { post: Writing | null }).post;

  const [regular, bold] = await Promise.all([loadFont(400), loadFont(600)]);

  const bg = "#f5f2ec";
  const fg = "#1c1b19";
  const dim = "#6b6963";
  const accent = "#8a3a1f";

  const headline = post ? post.data.title : "diegodelgado.io";
  const meta = post
    ? `## writings / ${post.data.date}`
    : "## senior sre · madrid";
  const footLeft = `${site.name} · ${site.role}`;
  const footRight = post ? `${post.data.read} min · ${post.data.words.toLocaleString()} words` : site.domain;

  const markup: any = {
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

  const svg = await satori(markup, {
    width: 1200,
    height: 630,
    fonts: [
      { name: "JetBrains Mono", data: regular, weight: 400, style: "normal" },
      { name: "JetBrains Mono", data: bold,    weight: 600, style: "normal" },
    ],
  });
  const png = new Resvg(svg).render().asPng();
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" },
  });
};
