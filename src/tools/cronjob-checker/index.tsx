import type { ToolMeta } from "../index";

export const meta: ToolMeta = {
  slug: "cronjob-checker",
  title: "k8s CronJob checker",
  blurb:
    "Paste a CronJob manifest. Get a lint report for the six footguns I wrote about.",
  tags: ["k8s", "lint"],
};
