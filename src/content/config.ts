import { defineCollection, z } from "astro:content";

const writings = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.string(),
    excerpt: z.string(),
    tags: z.array(z.string()).default([]),
    read: z.number(),
    words: z.number(),
    draft: z.boolean().optional().default(false),
  }),
});

export const collections = { writings };
