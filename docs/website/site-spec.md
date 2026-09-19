# hvnt33.com site spec

The build rules for hvnt33.com: stack, package versions, security, content, responsive design and the checks that gate a release. The look and the writing rules are in [brand-guide.md](brand-guide.md). Both are binding.

## Where it lives

- A new workspace at `apps/web`, package name `@hvnt33/web`, private, `"license": "AGPL-3.0-only"` like the rest of the repository.
- It builds and tests on its own (`npm run build -w @hvnt33/web`), and is added to the root `verify` script once it exists.
- It never imports from `apps/server` or `apps/desktop`. It may import from `packages/core` only for shared constants (for example the list of engines), so the site can't drift from the product.

## Stack and versions

Versions below were the npm `latest` dist-tag on 2026-09-18. They are the floor, not a pin to keep forever.

| Package | Version | Role |
|---|---|---|
| `next` | 16.3.5 | Framework, App Router |
| `react`, `react-dom` | 19.3.0 | |
| `typescript` | 7.0.2 (see note) | |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.3 | Styling, tokens as CSS variables |
| `unified`, `remark-parse`, `remark-gfm`, `remark-rehype`, `rehype-slug`, `rehype-stringify` | 11.0.5, 11.0.0, 4.0.1, 11.1.2, 6.0.0, 10.0.1 | The repository's Markdown to HTML, at build time |
| `shiki`, `@shikijs/rehype` | 4.4.3 | Build-time code highlighting, colored from the brand tokens |
| `sharp` | 0.35.4 | Screenshot crops and AVIF/WebP variants (dev only) |
| `babel-plugin-react-compiler` | 1.0.0 | React Compiler |
| `eslint`, `eslint-config-next` | 10.11.0, 16.3.5 | Lint (run through the ESLint CLI; Next 16 removed `next lint`) |
| `@types/react`, `@types/node` | 19.3.0, 26.6.2 | |
| `@playwright/test` | 1.63.0 | Browser tests |
| `@axe-core/playwright` | 4.13.0 | Accessibility checks |

Node: the repository's `engines` (22.18 or later). CI runs the current Node Active LTS.

TypeScript 7 works with `next build` (checked with Next 16.3.5). If a later Next release breaks that, pin the newest TypeScript it supports in `apps/web` only, with a comment saying why, the way `packages/api-client` pins TypeScript 5.9.

ESLint 10 note: `eslint-plugin-react` (pulled in by `eslint-config-next`) crashes when it auto-detects the React version under ESLint 10, so `eslint.config.mjs` names the version. Remove that setting once the plugin supports ESLint 10.

Not used, on purpose:

- **Fumadocs.** Its UI fights the brand, and its content loader expects docs inside the app. The manual lives in the repository's own Markdown, so a small unified pipeline (`src/lib/markdown.ts`) renders it, and the search index is a static JSON file built with the site.
- **Animation libraries.** The one reveal interaction is CSS and a few lines of pointer handling. Add `motion` only if that proves impossible, and justify it in the PR.
- **Component kits** (shadcn/ui, Radix themes, Material, Chakra) and **icon packs**. They carry the look this brand avoids. The few icons needed (external link, copy, menu, theme) are hand-drawn inline SVG.
- **Analytics, tag managers, chat widgets, font CDNs, embeds.** See Privacy.

## Package and supply chain rules

1. **Latest stable only.** Before adding or upgrading a package, check `npm view <pkg> version` and use that version. Never `canary`, `beta`, `rc`, `preview`, `next` or `experimental` tags, and never Next.js experimental flags, unless the user approves a specific one.
2. **Exact pins.** The repository's root `.npmrc` sets `save-exact=true` (npm reads it for every workspace). No `^` or `~` in its `package.json`. The root `package-lock.json` is committed, and CI installs with `npm ci`.
3. **Stay current.** Renovate or Dependabot opens update PRs weekly; patch and minor updates for Next, React and security fixes are merged within a week, after the quality gates pass. Majors get their own PR with the upgrade guide read and followed.
4. **Audit gate.** `npm audit --omit=dev --audit-level=moderate` must pass. Dev-only advisories are fixed or documented in the PR.
5. **Few dependencies.** A new runtime dependency needs a sentence in the PR on why 30 lines of our own code won't do. Check its maintenance (recent releases, open security issues), weekly downloads and install scripts before adding it.
6. **No install scripts** from new packages without review: add them to an allowlist deliberately.
7. **Provenance.** Prefer packages published with npm provenance. `npm audit signatures` runs in CI.
8. **No secrets in the client.** Nothing secret goes in a `NEXT_PUBLIC_` variable. The site needs no secrets at runtime.

## Rendering and hosting

The site is hosted on **Vercel**. `apps/web/vercel.json` sets the build (`npm run build`), serves the static `out/` directory with clean URLs, and sends the security headers. In the Vercel project, set the Root Directory to `apps/web`; Vercel installs from the repository root's lockfile.


- Every page is statically generated at build time. No server-side rendering per request, no Next API routes, no server actions, no `proxy.ts`. The one exception is the newsletter's Vercel Function (`apps/web/api/newsletter.ts`), written down under Investigations and the newsletter.
- Prefer `output: "export"` so the site is plain files that any static host or CDN can serve. If a Next feature the site needs rules that out, write down which one here.
- Enable the React Compiler (`reactCompiler: true`) and keep Turbopack (Next 16's default) for dev and build.
- `poweredByHeader: false`.
- Docs search is a static index built at build time and searched in the browser. No hosted search service.

## Security

The site is a brochure and a manual, but it is the front door of a security-minded product. A visitor who opens devtools should find nothing to criticize.

Response headers, set in `apps/web/vercel.json` (a static export can't set them from Next):

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' <narrowed per page, below>; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

- **Script policy.** Next's App Router emits inline scripts for the React Server Components payload, and they differ per page. After the build, `scripts/csp.ts` adds a `<meta http-equiv="Content-Security-Policy">` to each page listing `'self'` and the SHA-256 of each of that page's inline scripts. Browsers enforce the header and the meta policy together, so the header's `'unsafe-inline'` never takes effect: an inline script runs only if its hash is listed. A test injects an unlisted inline script and checks that it is blocked. `'unsafe-eval'` is never acceptable.
- **No third-party origins at all.** Fonts are self-hosted through `next/font`, images are local, there are no embeds. The CSP above has no external hosts, and a test checks that a full page load makes no request off the site's origin.
- `dangerouslySetInnerHTML` only for build-time output of our own MDX and Shiki. Never for anything that comes from a URL, query string or external source.
- External links: `rel="noopener noreferrer"`.
- **Install instructions never pipe a download into a shell** (`curl ... | sh`). They clone the repository and run named npm scripts, exactly as the README does. When signed builds exist, the download page lists each file's SHA-256 and how to check it.
- `security.txt` at `/.well-known/security.txt` pointing to the process in `SECURITY.md`, with an expiry date the release checklist renews.
- DNS for hvnt33.com: CAA records naming only the certificate authority in use, DNSSEC on, and the HSTS preload list once the site is stable.

## Privacy

hvnt33 has no telemetry. The site holds itself to the same standard.

- No analytics, no cookies, no local storage except the theme choice, no fingerprinting, no third-party requests.
- Vercel keeps its standard request logs; the privacy page says so. If visit counts are ever wanted, use the host's server-side logs, never a client-side tracker, and update the privacy page first.
- The privacy page states the above in four or five plain sentences.

## Information architecture

| Route | What | Content source |
|---|---|---|
| `/` | Home: line, reveal hero, one screenshot, the numbered ledger of what it does, privacy and integrity stance, two calls to action | Written for the site |
| `/features` | Every shipped feature, one entry each, anchor per feature (`/features#search-lab`) | Written for the site, each entry linking to its doc |
| `/download` | Downloading and running the browser | See Download, below |
| `/cloud` | The hosted service, Founding 100 and public investigation network | Written for the site |
| `/community` | The Discord community and its research-safety boundary | Written for the site |
| `/docs` and `/docs/[...slug]` | The manual | The repository's `docs/` and `apps/desktop/README.md` (see Docs) |
| `/security` | The security model and how to report a vulnerability | `SECURITY.md` and the desktop README's Security model section |
| `/investigations` | The owner's research and the newsletter | `apps/web/content/investigations/` (see Investigations and the newsletter) |
| `/changelog` | Releases | `CHANGELOG.md` |
| `/privacy` | What the site and the app collect (nothing) | Written for the site |
| `/404` | Non inventum | |

Also: `sitemap.xml`, `robots.txt`, one Open Graph image (`/og.png`, rendered at build time in the display face), a web app manifest, `/search.json` (the docs search index) and the mark as an SVG favicon (`src/app/icon.svg`, written by `scripts/mark.ts`).

Navigation: wordmark, Download, Investigations, Cloud, Docs, Community, Source (the GitHub repository, marked as external). On phones, a single menu button opens a full-height sheet. No mega menus.

## Features to present

Only what has shipped. Each entry: an English heading, a Roman numeral, two or three sentences, a real screenshot crop, a link to its doc. Where a limit applies, a † footnote states it. Keep this list in step with `README.md` and `apps/desktop/README.md`; when they change, this changes.

| # | Feature | What to say | Doc |
|---|---|---|---|
| I | Search every engine | ⌘K runs one query on Google, DuckDuckGo, Bing, Brave, Startpage, Mojeek and Yandex, one tab each. Every results page you see is recorded: engine, query, rank, title, URL, snippet and time. Consent pages and bot checks are reported, never bypassed. | desktop README, Searching |
| II | The page as data | A panel beside every page (⌘3). On results pages: ranks, domains, which other engines returned the same URL, and whether the case already captured, cited or visited it. On any page: author, dates, canonical URL, and the sites it links to most. | desktop README, The page as data |
| III | Search Lab | A Splunk-style query language over everything the case has seen and kept. `sourcetype=serp \| compare` shows each URL's rank on each engine; `\| changes` shows what moved since the last run. | desktop README, Search Lab |
| IV | Capture in one keystroke | Highlight text or point at an image and press ⌘⇧S. The exact selection, its paragraph, the page's citation metadata and the search that led there are saved; image originals are archived with a SHA-256. | desktop README, Capturing |
| V | An agent that files, and a human who checks | Claude Code or Codex in a terminal in the same window reads each capture and files people, organizations, events and claims into the case, each with the exact quote it came from. Everything it files is Unverified until you review it, and your reviews are recorded apart from its filing. † You bring your own Claude Code or Codex. | Agent workflow |
| VI | The case | Records with their source quotes, verification status (Unverified, Corroborated, Verified, Disputed), connections with evidence, a map you can arrange and export as SVG, a timeline, and a review queue for staged captures. | desktop README, The case; Using hvnt33 |
| VII | The Wayback Machine, inline | Every page shows how many versions the Internet Archive holds, first and last capture, and the version nearest its publication date. Archive now asks it to capture the page. † Archive now needs a free archive.org account. | desktop README, Web archive |
| VIII | Your own archive, independently timestamped | Snapshot any page as a replayable web archive (WACZ) with its text and a screenshot. Two independent timestamp authorities (DigiCert and FreeTSA) sign its hashes. The evidence package can be checked by anyone with `shasum` and `openssl`, without hvnt33. | desktop README, Your own archive |
| IX | Watch pages for changes | Snapshot a page every 6 hours, day or week, and see the lines it added and removed, with replays of before and after. | desktop README, Your own archive |
| X | A connection per case | Each case can browse direct, through a SOCKS5 or HTTP proxy (with logins kept on your computer, never in the case), or through Tor on its own circuit, so two cases can't be tied together by IP. Lock a case to its exit and it pauses if the route drops or moves. WebRTC is removed from pages. † A route hides your IP address, not who you are. | desktop README, Connection per case |
| XI | Separate identities per case | Each case keeps its own tabs and, by default, its own cookies and logins. Switching cases swaps the whole browser. | desktop README, Tabs and browser profiles |
| XII | Export a dossier | Choose records and save an offline HTML dossier with the map, CSV and JSON, and the originals, or export the whole case. | desktop README, The case |
| XIII | Local first | The server, the ArcadeDB database and Tor are built into the app; local cases live on your computer. Local use needs no HVNT33 account and sends no telemetry. Connect to a hosted hvnt33 server instead if you choose; its token is kept encrypted by the operating system. | Architecture; Operations |
| XIV | Built to be attacked | Web pages run with no access to the app, the terminal or your files, and tests prove it from inside a live page. Replayed archives run on a separate origin with no API. | desktop README, Security model |

Platform line, stated plainly on Home, Features and Download: **macOS, Windows and Linux. Open source under AGPL-3.0. Signed installers are coming; today you build it from source.** (One app: the server, the database and Tor are built in; no Docker.)

## Download

The page most likely to lose people, so it gets the most care.

Structure:

1. **Incipit.** One paragraph: what you'll have at the end (the app open, a demo case loaded), and that the app brings its own server, database and Tor.
2. **What you need**, from the README's list, with the command that proves each one: a computer on macOS, Windows or Linux; Node.js 22.18+ (`node --version`); optionally Claude Code or Codex (`claude --version`).
3. **Steps**, one command block each, and under each block: what it did, and what you should see when it worked. Today: clone and `npm install`, `npm run setup` (writes `.env`, installs the built-in database and Tor, checksum-verified), `npm run desktop`, optional `npm run demo`.
4. **Your first investigation**: the steps from the README.
5. **When something goes wrong**: real failure modes only, each with its symptom and fix (Node too old, the first build taking a while, built-in Tor not installed, bot checks from engines, captures not filed).
6. **Next**: links to Using hvnt33, the desktop app, the agent workflow, and Operations.

Rules:

- Commands on the site are read from the README's Install section at build time (`src/lib/install.ts`), so they can't drift. A README command the site has no explanation for fails the build.
- Every command block has a copy button that copies only the command, never the `$` prompt or the comments.
- The GitHub URL is the real repository, never `{{GITHUB_REPO}}`. The build fails if any `{{...}}` placeholder reaches the output.
- Before each release, someone runs the page's commands, literally, on a macOS user account that has never run hvnt33, and records the date in the release checklist.

## Investigations and the newsletter

The owner's research, published as a blog and sent as a newsletter, in the manner of Substack but owned outright: the posts live in this repository, the list lives in the owner's Resend account and can be exported at any time.

**Writing.** One Markdown file per post in `apps/web/content/investigations/`, with front matter (`title`, `date` as YYYY-MM-DD, `summary`, optional `draft: true`). The file name is the address. `_example.md` is the template; files starting with an underscore never publish. Drafts show only in `npm run dev`. The writing rules and the content lint apply to posts like every other page.

**Pages.** `/investigations` (the list, with the subscribe form), `/investigations/<slug>` (the post, subscribe form at the end), `/investigations/feed.xml` (RSS), and three small pages for the subscribe flow: `check-your-email`, `subscribed`, `link-expired`.

**Subscribing** (`apps/web/api/newsletter.ts`, a Vercel Function; the only server code on the site):

- `POST /api/newsletter` sends a confirmation email through Resend. Nothing is stored yet.
- The link in it carries the address and the time, signed with `NEWSLETTER_SECRET`, and expires after 7 days. `GET /api/newsletter?t=...` checks it and adds the address to the Resend segment (or subscribes a returning reader again).
- Only this site's forms are accepted (`Sec-Fetch-Site`, then `Origin`). A hidden field catches simple bots. At most one confirmation email per address per day (Resend idempotency key).
- The form works without JavaScript (it redirects to `check-your-email`); with JavaScript it answers in place.
- `scripts/serve.ts` runs the function locally exactly as Vercel does; the tests run it against `tests/fake-resend.ts`.

**Sending.** `npm run newsletter -w @hvnt33/web -- preview <slug>` writes the email to `out-email/` to look at. `-- send <slug>` creates it in Resend as a draft broadcast to review and send from the Resend dashboard; `--now` sends at once. Drafts can't be sent. Every email has a "Read it on the web" link and Resend's one-click unsubscribe (`{{{RESEND_UNSUBSCRIBE_URL}}}`).

**Setting it up** (once):

1. In Resend, add and verify the domain hvnt33.com (the DNS records it lists), and turn off open and click tracking for it, to match the site's privacy promise.
2. Create a segment for the newsletter (Audience, Segments) and copy its ID.
3. Create an API key with full access.
4. In the Vercel project, set `RESEND_API_KEY`, `RESEND_SEGMENT_ID`, `NEWSLETTER_FROM` (for example `HVNT33 Investigations <investigations@hvnt33.com>`), `NEWSLETTER_SECRET` (`openssl rand -base64 32`) and `SITE_URL`. For sending from your machine, put the same in `apps/web/.env.local` (git-ignored; see `.env.example`).
5. Without these the form says the newsletter isn't set up yet, and the rest of the site works as before.

**Limits.** Anyone can make the form send one confirmation email per day to an address they type in; the email asks for nothing and does nothing unless clicked. If that is ever abused, add a rate limit rule for `/api/newsletter` in Vercel's firewall.

## Docs

- **One source of truth.** The manual is the repository's own Markdown: `docs/using-hvnt33.md`, `docs/agent-workflow.md`, `docs/operations.md`, `docs/ARCHITECTURE.md`, `apps/desktop/README.md` and the Install section of `README.md`. The site reads them at build time (`src/lib/markdown.ts`). It never keeps copies. `docs/notes/` and `docs/website/` are not published.
- `docPages` in `src/lib/markdown.ts` names each published page: source file, slug, title, order. Relative links between repository files become site URLs when the target is published and GitHub links when it isn't. The link test fails on any internal link or anchor that doesn't resolve.
- Page layout: running head (*Liber I · Getting started*), title, body at a comfortable measure, the table of contents in the right margin on wide screens and collapsed at the top on phones, § anchors on headings, previous and next at the bottom, and "Edit this page" linking to the file on GitHub.
- Code blocks highlighted by Shiki at build time with a theme built from the brand tokens (ink or vellum background, rubric for keywords, gilt for strings, dim for comments), with a copy button. Keyboard shortcuts render as keycaps in Plex Mono.
- Search: ⌘K (or /) opens it. Static index, results in the browser.
- Docs pages follow the brand guide's writing rules. Where the repository's Markdown doesn't yet (em dashes, for example), fix the source file, not the site.

## Responsive design

Designed for phones first, and deliberately for wide screens, not stretched to them.

- **Widths to design and test:** 320, 375, 414, 768, 1024, 1280, 1440, 1920, 2560. Nothing scrolls horizontally at any of them, including code blocks (they scroll inside themselves) and tables (they scroll inside a labelled container or reflow into stacked rows).
- **Gutters:** 16px on phones, growing fluidly to 48px. Content never touches the screen edge.
- **Measure:** prose is capped at 70 characters. On wide screens the extra space goes to margins and marginalia (docs table of contents, figure captions, † footnotes), like a book, not to longer lines or bigger cards.
- **Fluid type and space** with `clamp()` between the 320 and 1440 widths. No breakpoint-by-breakpoint font size overrides.
- **Breakpoints come from the content.** Change the layout where it breaks, and use container queries for components that appear in more than one context (feature entries, figures).
- **Touch:** targets at least 44 by 44px, no hover-only information, the reveal hero works on scroll for touch devices.
- **Screenshots:** served in sizes suited to each width (`srcset`/`sizes`), with phone-specific crops where the full window would be illegible (brand guide, Imagery). Width and height always set so nothing shifts.
- **Look and components:** the brand guide's section 6 lists the Roman vocabulary (emblema, meander band, carved numerals, tessera, the tile film, black marble) and the files that implement each. Build new sections from those.
- **Themes:** Lapis is the site, whatever the system prefers. The lamp toggle switches to Nox (dark stone) and remembers the choice. Both are designed, not inverted, and both are tested.
- **Preferences respected:** `prefers-reduced-motion` (no reveal animation, bars never drawn), `prefers-contrast: more` (paper grain off, `--rule` becomes `--rule-strong`), `forced-colors` (layout survives Windows High Contrast).
- **Print:** docs print cleanly on vellum colors with URLs after links.

## Accessibility

WCAG 2.2 AA is the floor.

- Semantic landmarks, one `h1` per page, headings in order, a skip link.
- Every interactive element reachable and usable by keyboard, with a visible focus ring in `--gilt` (2px, offset 2px).
- The mosaic canvas and the story's stage are `aria-hidden`; the story's steps and conclusion are ordinary text.
- Screenshots have alt text that says what the image proves, not "screenshot of the app".
- Latin phrases carry `lang="la"` so screen readers pronounce them properly, and the English meaning is nearby or in a visible tooltip.
- Color is never the only signal.

## Performance budgets

Measured on a mid-range phone on a throttled 4G profile, production build. The JavaScript figures are enforced by the tests:

| Metric | Budget |
|---|---|
| Largest Contentful Paint | under 2.0s |
| Cumulative Layout Shift | under 0.05 |
| Interaction to Next Paint | under 150ms |
| JavaScript per page (gzip, first load, excluding `nomodule` polyfills) | under 170KB on Home (it carries the two mosaics) and 160KB on every other page. React and the Next router account for about 135KB of that on every page. |
| Fonts | at most 5 files, subset to Latin, `display: swap` with `next/font` size-adjusted fallbacks |
| Hero image | under 120KB, AVIF with WebP fallback |

Pages that don't need client-side JavaScript (Features, Download apart from copy buttons, Privacy) ship as close to none as Next allows: Server Components by default, `"use client"` only on the leaf that needs it.

## Quality gates

`npm run check -w @hvnt33/web` runs all of these, and CI runs it on every PR. A red gate blocks the merge.

1. `tsc` type check and ESLint with no warnings.
2. **Content lint** (below).
3. `next build` succeeds, and the output has no `{{...}}` placeholders.
4. **Link check** over the built site: every internal link and anchor resolves; external links are checked weekly, not per PR.
5. **Playwright** against the built site:
   - every route at 320, 768, 1440 and 2560 wide, in both themes: no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), no console errors, no failed requests;
   - axe on every route in both themes with no violations;
   - reduced motion: the story is complete and unpinned from the start;
   - no request leaves the site's origin;
   - the response headers from the host config, including the CSP, and no CSP violation reports on any page;
   - the mosaic draws and responds to the pointer; the story assembles with scrolling and ends on the conclusion; every revealed section ends up visible;
   - docs search, the theme choice, and copy buttons that copy commands without prompts;
   - every internal link and anchor resolves;
   - JavaScript per page stays inside the budget.
6. `npm audit --omit=dev --audit-level=moderate` and `npm audit signatures`.
7. `npm run shots -- DIR` screenshots the main pages at 375 and 1440 in both themes, for a person to look at before a release.

### Content lint

`apps/web/scripts/content-lint.ts` reads every exported page, the way a visitor would: visible text plus `alt`, `title`, `aria-label`, placeholders and meta descriptions, skipping code, commands and scripts. It fails on:

- `—` (U+2014) or `–` (U+2013) anywhere, and ` - ` used as a dash in prose;
- emoji (`\p{Extended_Pictographic}`, allowing ⌘ ⇧ ↵ ¶ § † ☞ ← → ↑ ↓);
- a sentence ending in `!` in prose (code blocks are skipped);
- any banned word from the brand guide's rule 9, whole-word and case-insensitive (code blocks are skipped);
- `{{` placeholders;
- `hvnt33` written with capitals (`Hvnt33`, `HVNT33` outside of code such as environment variable names).

It prints the file, line and the rule broken, so the fix is obvious.

## Decided

- Hosting: Vercel.
- Repository: `github.com/kai-ten/hvnt33` (`src/lib/site.ts`). The site replaces the README's `{{GITHUB_REPO}}` placeholder with it at build time.
- The line: see the brand guide, section 1.

## Open

- Screenshots of the demo case for the features (see the brand guide's Imagery rules); the site renders without them.
