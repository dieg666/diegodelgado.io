#!/usr/bin/env node
// Runs automatically before `astro build` (npm `prebuild` lifecycle hook).
// On Cloudflare Pages and other CI envs the clone may be shallow; the
// changelog page reads `git log` at build time, so we need full history.
import { execSync } from "node:child_process";

function sh(cmd) {
  return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

try {
  const isShallow = sh("git rev-parse --is-shallow-repository") === "true";
  if (isShallow) {
    console.log("[prebuild] shallow clone detected → git fetch --unshallow");
    execSync("git fetch --unshallow", { stdio: "inherit" });
  } else {
    console.log("[prebuild] full clone → nothing to do");
  }
} catch (err) {
  // Not a git repo (e.g. tarball deploy). Build continues; changelog page
  // will fall back to an empty list.
  console.warn("[prebuild] git not available:", err.message.split("\n")[0]);
}
