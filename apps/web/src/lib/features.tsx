// Every shipped feature, as the site presents it. Keep in step with README.md
// and apps/desktop/README.md: when they change, this changes.
import type { ReactNode } from "react";
import { K } from "@/components/Keys";

export interface Feature {
  id: string;
  numeral: string;
  title: string;
  body: ReactNode;
  note?: ReactNode;
  doc: { href: string; label: string };
  figure?: string;
  home?: boolean;
}

export const features: Feature[] = [
  {
    id: "search-every-engine", numeral: "I", title: "Search every engine at once", home: true, figure: "search",
    body: <>Press <K>⌘K</K> and one query runs on Google, DuckDuckGo, Bing, Brave, Startpage, Mojeek and Yandex, each in its own tab. Every results page you see is recorded for the case: engine, query, rank, title, URL, snippet and time. Consent pages and bot checks are reported, never bypassed.</>,
    doc: { href: "/docs/desktop#working-in-it", label: "Searching" },
  },
  {
    id: "page-as-data", numeral: "II", title: "Every page, as data", figure: "page-data",
    body: <>A panel docks beside the page (<K>⌘3</K>). On a results page it lists rank, domain and snippet, which other engines returned the same URL, and whether the case already captured, cited or visited it. On any other page it shows what the page declares: author, published and modified dates, canonical URL, and the sites it links to most.</>,
    doc: { href: "/docs/desktop#working-in-it", label: "The page as data" },
  },
  {
    id: "search-lab", numeral: "III", title: "A query language for what you've seen", home: true, figure: "lab",
    body: <>The Search Lab (<K>⌘2</K>) runs a Splunk-style language over everything the case has collected. <code>sourcetype=serp | compare</code> shows each URL&rsquo;s rank on each engine. <code>| changes</code> shows what appeared, dropped or moved since the last run.</>,
    doc: { href: "/docs/desktop#working-in-it", label: "Search Lab" },
  },
  {
    id: "capture", numeral: "IV", title: "Capture evidence in one keystroke", home: true, figure: "capture",
    body: <>Highlight a passage or point at an image and press <K>⌘⇧S</K>. The exact selection is saved with its paragraph, the page&rsquo;s title, author, date and canonical URL, and the search that led you there. Image originals are archived with a SHA-256.</>,
    doc: { href: "/docs/desktop#working-in-it", label: "Capturing" },
  },
  {
    id: "agent", numeral: "V", title: "An agent files it. You check it.", home: true, figure: "review",
    body: <>Claude Code or Codex runs in a terminal in the same window. It reads each capture and files people, organizations, events and claims into the case, each with the exact quote it came from. Everything it files stays Unverified until you review it, and your reviews are recorded apart from its filing.</>,
    note: <>You bring your own Claude Code or Codex. Page content never passes through the terminal; it receives only IDs.</>,
    doc: { href: "/docs/agent-workflow", label: "Agent workflow" },
  },
  {
    id: "case", numeral: "VI", title: "The case, with its sources attached", figure: "map",
    body: <>Records carry their source quotes and a status (Unverified, Corroborated, Verified, Disputed). Connections carry their evidence. Arrange the map and export it as SVG, read the timeline, and choose what enters the case from captures staged for review.</>,
    doc: { href: "/docs/using-hvnt33", label: "Using HVNT33" },
  },
  {
    id: "wayback", numeral: "VII", title: "The Wayback Machine, beside every page", figure: "wayback",
    body: <>See how many versions the Internet Archive holds of the page you&rsquo;re reading, its first and last capture, and the version nearest its publication date. <b>Archive now</b> asks the archive to capture it.</>,
    note: <>Archive now needs a free archive.org account. Lookups send the page&rsquo;s URL to the Internet Archive; you can switch them to on-request.</>,
    doc: { href: "/docs/desktop#working-in-it", label: "Web archive" },
  },
  {
    id: "own-archive", numeral: "VIII", title: "Remember what the internet forgets", home: true, figure: "archive",
    body: <>Snapshot any page as a replayable web archive (WACZ) with its text and a screenshot. DigiCert and FreeTSA each sign a timestamp over its hashes. The evidence package checks out with <code>shasum</code> and <code>openssl</code>, on any machine, without HVNT33.</>,
    note: <>Snapshots are taken by the app&rsquo;s own browser in a fresh session, with no cookies or sign-ins, through the case&rsquo;s connection.</>,
    doc: { href: "/docs/desktop#working-in-it", label: "Your own archive" },
  },
  {
    id: "watch", numeral: "IX", title: "Know when a page changes what it says",
    body: <>Watch a page every 6 hours, every day or every week. When its text changes, HVNT33 records the lines added and removed, with replays of the page before and after. <code>sourcetype=change removed_text=&quot;*treasurer*&quot;</code> finds what a page stopped saying.</>,
    doc: { href: "/docs/desktop#working-in-it", label: "Watches" },
  },
  {
    id: "connection", numeral: "X", title: "A connection per case", home: true,
    body: <>Each case browses direct, through a SOCKS5 or HTTP proxy, or through Tor on its own circuit, so two cases can&rsquo;t be tied together by IP address. Lock a case to its exit and it pauses the moment the route drops or moves. Snapshots and archive lookups use the same route. WebRTC is removed from every page.</>,
    note: <>A route hides your IP address, not who you are. Logged-in accounts, fingerprints and habits can still identify you. HVNT33 is not Tor Browser.</>,
    doc: { href: "/docs/desktop#working-in-it", label: "Connection per case" },
  },
  {
    id: "profiles", numeral: "XI", title: "A separate identity for each case",
    body: <>Each case keeps its own tabs and, by default, its own cookies and logins. Switching cases swaps the whole browser, so a research account in one case never shows up in another.</>,
    doc: { href: "/docs/desktop#working-in-it", label: "Tabs and browser profiles" },
  },
  {
    id: "export", numeral: "XII", title: "Hand over a dossier",
    body: <>Choose the records that matter and save an offline HTML dossier with the map as SVG, CSV and JSON, and the original files. Or export the whole case.</>,
    doc: { href: "/docs/using-hvnt33", label: "Exports" },
  },
  {
    id: "local-first", numeral: "XIII", title: "It runs on your machine",
    body: <>The server, the ArcadeDB database and Tor are built into the app, and local cases live on your computer in the database and a checksummed evidence vault. Local use needs no HVNT33 account and sends no telemetry. Connect to a hosted HVNT33 server when you choose, with the API token kept encrypted by your operating system.</>,
    doc: { href: "/docs/architecture", label: "Architecture" },
  },
  {
    id: "security", numeral: "XIV", title: "Built on the assumption that pages are hostile",
    body: <>Web pages run with no access to the app, the terminal or your files, and the end-to-end test proves it from inside a live page. Replayed archives run on a separate origin with no API. Requests to the server go through the native side only.</>,
    doc: { href: "/security", label: "Security model" },
  },
];
