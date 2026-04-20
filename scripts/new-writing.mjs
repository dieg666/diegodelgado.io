#!/usr/bin/env node
// Scaffold a new writing: creates src/content/writings/<slug>.md with
// frontmatter matching the zod schema in src/content/config.ts.
//
// Usage:
//   npm run new:writing <slug>
//   npm run new:writing k8s-resource-requests-math

import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const writingsDir = join(root, "src/content/writings");

const slug = process.argv[2];
if (!slug) {
  console.error("usage: npm run new:writing <slug>");
  console.error("example: npm run new:writing k8s-resource-requests-math");
  process.exit(1);
}

if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(`invalid slug: ${slug} (must be lowercase, [a-z0-9-]+)`);
  process.exit(1);
}

const target = join(writingsDir, `${slug}.md`);
if (existsSync(target)) {
  console.error(`already exists: ${target}`);
  process.exit(1);
}

mkdirSync(writingsDir, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const body = `---
title: ""
date: "${today}"
excerpt: ""
tags: []
draft: true
---

Write here.
`;

writeFileSync(target, body, "utf8");
console.log(`created ${target}`);
console.log("next: fill in title/excerpt/tags, flip draft to false when ready.");
