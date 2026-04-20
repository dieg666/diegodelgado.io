import type { ToolMeta } from "../index";

export const meta: ToolMeta = {
  slug: "burn-rate",
  title: "Burn-rate alert helper",
  blurb:
    "Pick an SLO and a window, get the multi-window multi-burn-rate Prometheus rules ready to paste.",
  tags: ["alerting", "prometheus"],
};
