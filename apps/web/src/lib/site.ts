// One place for the words and links every page shares.

export const site = {
  name: "HVNT33",
  url: "https://hvnt33.com",
  repo: "kai-ten/hvnt33",
  line: "Every secret is a mosaic of public pieces.",
  // The keyword line: page titles, search results and link previews.
  category: "The browser for OSINT",
  audience: "The browser for OSINT, investigative journalists, and threat intelligence analysts.",
  description:
    "HVNT33 is the open-source browser built for investigation. Search across engines, preserve what you find, and keep every finding connected to its source.",
  platform: "macOS, Windows and Linux",
  license: "AGPL-3.0",
  founding: {
    name: "The Founding 100",
    limit: 100,
    price: 199,
    checkout: process.env.NEXT_PUBLIC_FOUNDING_CHECKOUT_URL ?? "",
  },
  discord: "https://discord.gg/Y22TyQAQmu",
} as const;

export const github = `https://github.com/${site.repo}`;
export const blob = (path: string) => `${github}/blob/main/${path}`;
