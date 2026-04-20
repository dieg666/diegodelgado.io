export const site = {
  name: "diego delgado",
  domain: "diegodelgado.io",
  role: "senior sre",
  location: "Barcelona, ES",
  github: "dieg666",
  email: "ddd.barna@gmail.com",
  lastDeploy: "2026-04-18",

  now: {
    updated: "2026-04-12",
    items: [
      "Writing about synthetic checks that actually catch regressions.",
      "Building a k8s cronjob linter — the one I wish existed in 2022.",
      "Reading: Seeking SRE, and re-reading the Google SRE workbook.",
      "Running srereview.com on the side — SLO reviews for small teams.",
    ],
  },

  fortunes: [
    "$ cat /dev/runbook → Permission denied. You are not on-call this week.",
    "The best alert is the one that pages, resolves itself, and leaves a note.",
    "It was DNS. It is always DNS. Accept this and move on.",
    "A dashboard nobody opens is a monument to wasted observability spend.",
    "If the incident was prevented, nobody will thank you. Write it down anyway.",
    "An SLO you don't negotiate is a target you don't own.",
    "Every alert without a runbook is a 3am interview question.",
    "Retries without backoff are denial-of-service attacks you wrote yourself.",
    "The test environment is a lie. The staging environment is a bigger lie.",
    "Your scariest incidents are the ones that don't page anyone.",
  ],

  bookmarks: [
    {
      cat: "Reading",
      items: [
        { t: "Dan Luu", u: "https://danluu.com" },
        { t: "Lethain (Will Larson)", u: "https://lethain.com" },
        { t: "SRE at Google", u: "https://sre.google" },
        { t: "Increment (archive)", u: "https://increment.com" },
      ],
    },
    {
      cat: "Tools",
      items: [
        { t: "sre.deals", u: "#" },
        { t: "sloth (SLO generator)", u: "#" },
        { t: "k6", u: "#" },
      ],
    },
    {
      cat: "Ops",
      items: [
        { t: "Google SRE Workbook", u: "#" },
        { t: "Awesome SRE", u: "#" },
      ],
    },
  ],

  about: [
    "I'm Diego, a Senior SRE based in Barcelona. I've spent the last eight years on-call for teams ranging from four people to four hundred, and most of what I write here is some version of \"here is the thing I wish somebody had told me earlier.\"",
    "I care about boring reliability. The unglamorous checks. The runbook you can read at 3am with one eye open. Error budgets as a negotiation tool, not a scoreboard. Postmortems that change something.",
    "On the side I run srereview.com — lightweight SLO and on-call reviews for small engineering teams. If that sounds useful, it probably is.",
    "The fastest way to reach me is email.",
  ],

  links: [
    { label: "github",   url: "https://github.com/dieg666" },
    { label: "linkedin", url: "https://www.linkedin.com/in/diegodelgadodiaz/" },
    { label: "email",    url: "mailto:ddd.barna@gmail.com" },
  ],
};

export const nav = [
  { label: "~",         href: "/",          key: "home" },
  { label: "writings",  href: "/writings/", key: "writings" },
  { label: "tools",     href: "/tools/",    key: "tools" },
  { label: "bookmarks", href: "/bookmarks/", key: "bookmarks" },
  { label: "changelog", href: "/changelog/", key: "changelog" },
  { label: "about",     href: "/about/",    key: "about" },
] as const;

export type NavKey = (typeof nav)[number]["key"];
