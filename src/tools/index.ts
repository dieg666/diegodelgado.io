export interface ToolMeta {
  slug: string;
  title: string;
  blurb: string;
  tags: string[];
}

interface ToolModule {
  meta: ToolMeta;
}

const modules = import.meta.glob<ToolModule>("./*/index.tsx", { eager: true });

export const tools: ToolModule[] = Object.values(modules).sort((a, b) =>
  a.meta.slug.localeCompare(b.meta.slug),
);

export function getTool(slug: string): ToolModule | undefined {
  return tools.find((t) => t.meta.slug === slug);
}
