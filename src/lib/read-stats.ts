// Derive reading time + word count from a post's raw markdown body.
// Lives here (not in frontmatter) because it's purely a function of content.
// `scripts/generate-og.mjs` duplicates this logic — keep the two in sync if
// you change the WPM or stripping rules.

const WORDS_PER_MINUTE = 225;

export interface ReadStats {
  read: number;
  words: number;
}

export function readStats(body: string): ReadStats {
  const stripped = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<[^>]+>/g, " ");
  const words = stripped.split(/\s+/).filter(Boolean).length;
  const read = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  return { read, words };
}
