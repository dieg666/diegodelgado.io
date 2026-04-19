import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import mdx from "@astrojs/mdx";

export default defineConfig({
  site: "https://diegodelgado.io",
  integrations: [preact(), mdx()],
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: true,
    },
  },
  build: { format: "directory" },
});
