#!/usr/bin/env node
// Scaffold a new tool: creates src/tools/<slug>/index.tsx with meta + a null
// Component (coming-soon placeholder). Replace `Component = null` with a real
// Preact component when ready to build it.
//
// Usage:
//   npm run new:tool <slug> "<title>" "<blurb>"
//   npm run new:tool burn-rate-helper "Burn rate helper" "Pick an SLO, get the rules."

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const toolsDir = join(root, "src/tools");

const [, , slug, title, blurb] = process.argv;

if (!slug || !title || !blurb) {
  console.error('usage: npm run new:tool <slug> "<title>" "<blurb>"');
  console.error('example: npm run new:tool burn-rate-helper "Burn rate helper" "Pick an SLO, get the rules."');
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(`invalid slug: ${slug} (must be lowercase, [a-z0-9-]+)`);
  process.exit(1);
}

const targetDir = join(toolsDir, slug);
const targetFile = join(targetDir, "index.tsx");

if (existsSync(targetDir)) {
  console.error(`already exists: ${targetDir}`);
  process.exit(1);
}

mkdirSync(targetDir, { recursive: true });

const escape = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const body = `import type { ToolMeta } from "../index";

export const meta: ToolMeta = {
  slug: "${escape(slug)}",
  title: "${escape(title)}",
  blurb:
    "${escape(blurb)}",
  tags: [],
};
`;

const pascal = slug.replace(/(^|-)(.)/g, (_, __, c) => c.toUpperCase());

writeFileSync(targetFile, body, "utf8");
console.log(`created ${targetFile}`);
console.log("next:");
console.log("  1. fill in tags in meta");
console.log("  2. for an interactive tool, add a default-exported Preact component to this file:");
console.log(`       export default function ${pascal}() { ... }`);
console.log("  3. then in src/pages/tools/[slug].astro:");
console.log(`       import ${pascal} from "@/tools/${slug}";`);
console.log(`       and add a case: meta.slug === "${slug}" ? <${pascal} client:load /> : ...`);
