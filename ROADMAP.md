# hvnt33 roadmap

hvnt33 is an investigation workbench for tracking the web over time: search every engine, see results as data, capture and archive evidence, and file it into a graph with an AI agent. It ships as open source that runs entirely on your machine, with a hosted cloud for storage, sync, archiving and teams.

The phases are ordered so each one is usable on its own and nothing built early has to be rebuilt for the cloud. Design details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

| Phase | Theme | Outcome |
|---|---|---|
| 0 | Foundation | ✅ Done: search, capture, Search Lab, agent terminal, tested |
| 1 | See everything as data | ✅ Done: results and page metadata beside the page, not instead of it |
| 2 | The web's memory, borrowed | ✅ Done: Wayback Machine history and "archive now" as sources |
| 3 | Cloud-ready core | ✅ Done: TypeScript server, workspaces, seams, pricing hook, OpenAPI + typed client |
| 4 | The web's memory, owned | ✅ Done: own snapshots (WACZ), replay, watches, change diffs, trusted timestamps, verifiable evidence |
| 5 | Open-source release | In progress: license, CI, contributor path done; one app on macOS, Windows and Linux with the server, database and Tor built in; legal, name and signing are the maintainer's |
| 6 | hvnt33 Cloud | Accounts, sync, managed archiving, billing, teams |
| 7 | Web observatory | Long-term tracking across investigations, opt-in publishing |

---

## Phase 0: Foundation ✅

Completed 2026-09-18.

- [x] Desktop app: fan-out search across 7 engines, tabs as isolated views (first built on Tauri 2, rebuilt on Electron in Phase 5)
- [x] Observed search results recorded per case (`SearchRun`), with URL-quality labels for opaque engine links and bot-check detection
- [x] Capture selection / hovered image / whole page (⌘⇧S, ⌘⇧P) with provenance; image originals archived with SHA-256
- [x] Agent terminal (Claude Code, Codex, shell) receiving capture IDs only; skills for Claude Code and Codex
- [x] Search Lab: query language with `stats`, `top`, `dedup`, `compare`, `changes`, facets and histogram
- [x] Tests: 47 unit, 20 Rust, 8 server integration, 14-check live E2E with screenshots
- [x] Repository organized as `apps/`, `packages/`, `docs/`, `data/`; renamed to hvnt33

## Phase 1: See everything as data ✅

Completed 2026-09-18. Goal: every page you open is also a row of metadata, and you can move between the data and the page without losing either.

- [x] **Results panel** docked beside the page on results pages: rank, title, domain, snippet, URL quality, other engines that returned it (with ranks), captured / cited / visited. ↑↓ or j/k to move; ⏎ opens, ⌘⏎ opens in the background.
- [x] **Page details panel** for any page: type, site, author, published and modified dates, canonical URL, language, length, the search and rank that led here, most-linked domains, capture and visit status.
- [x] **Search Lab preview:** selecting a row opens the page in a pane next to the table.
- [x] **Cross-reference fields:** `captured`, `in_records` and `visited` on observed results ("Unread leads" preset).
- [x] **Saved searches** stored per case in ArcadeDB, with "re-run on all engines" and search history in the investigation pane.
- [x] **Visits** logged per case as `PageVisit` (`sourcetype=visit`), with declared metadata and how the page was found; can be turned off.
- [x] Archive history in the panels (Phase 2).

Verified by 20 live end-to-end checks, including cross-references on real Google, DuckDuckGo, Bing and Brave results.

## Phase 2: The web's memory, borrowed ✅

Completed 2026-09-18. Goal: every URL shows its archive history, and preserving a page takes one click.

- [x] Wayback Machine history through the CDX API: distinct content versions (newest 5,000 kept, true first capture looked up separately), first and last capture, per-year counts; cached 12 hours per URL; `sourcetype=snapshot` events, and `wayback_versions` on visits
- [x] Snapshot list per URL, "version nearest publication", and recognition of snapshot pages (`web.archive.org/web/…`) with a link back to the live page
- [x] **Archive now** via Save Page Now 2, with job status in Activity. Anonymous saves are refused by archive.org (verified: HTTP 401/429), so it uses the user's free archive.org keys
- [x] Archive on capture (opt-in; now a status-bar switch); the snapshot link is stored on the intake
- [x] Background job queue (the first local implementation of the `JobQueue` seam): persistent, paced per kind, retried with backoff, safe when several servers share a database
- [x] Wayback requests paced one at a time, retried once on network failure, errors reported with clear messages
- [x] Privacy control: automatic lookups can be switched to on-request
- [ ] Other archives (archive.today and Memento aggregators): links only for now
- [x] Changes across snapshot dates: delivered in Phase 4 as `PageChange` (`sourcetype=change`)

Verified by 24 live end-to-end checks against the real Wayback Machine. Save Page Now is covered by unit tests against the documented API but has not run live, because no archive.org keys are configured here.

## Phase 3: Cloud-ready core ✅

Completed 2026-09-18. The code runs the same locally and in a hosted shape, with differences confined to seams.

- [x] `apps/server` rewritten in readable TypeScript (run directly by Node, no build step), keeping every previous test assertion
- [x] Routes declared with zod: runtime validation, OpenAPI 3.1 at `/api/openapi.json`, generated typed client (`packages/api-client`) used by the desktop app, and response contract checks in tests
- [x] `workspaceId` on every owned type and query; existing data migrated into the `local` workspace
- [x] Versioned ArcadeDB migrations at startup, with a lock shared across servers
- [x] Seams with local implementations: `AuthProvider` (local trust, bearer tokens), `BlobStore` (content-addressed vault), `GraphStore`, `JobQueue`, `Entitlements` (plans, metering, 402)
- [x] `version`, `updatedAt`, `deletedAt` tombstones; `changes?since=`; record and connection deletion as tombstones
- [x] Desktop connects by URL and API token (token kept encrypted by the operating system, added by the native side); `npm run e2e -- --token` runs the live session against a hosted-shape server
- [x] Admin CLI for workspaces, tokens and plans; research CLI supports tokens
- [x] Bundle and launch the server inside the desktop app: done in Phase 5 (the app runs it with its own Node)
- [ ] Rebuild the original browser workspace on the shared components (it still works in local mode): moved to Phase 5

Verified: the same API tests pass in local and token profiles with contract checking. In token mode, 31 cross-workspace probes all return 404 and plan limits return 402. 24/24 live E2E checks pass in both modes. Existing data migrated in place (backup taken first).

## Phase 4: The web's memory, owned ✅

Completed 2026-09-18. hvnt33 keeps its own archive of what pages said, proves when, and shows what changed.

- [x] Capture service: first Webrecorder's browsertrix-crawler in Docker; since Phase 5 the app's own browser (a hidden window recorded over the DevTools protocol, through the case's route) produces the WACZ with screenshot and rendered text; a server without the app writes a WACZ of the HTML and says what it lacks
- [x] `Snapshot` documents: archive, text, screenshot and manifest as content-addressed blobs; the manifest's hash timestamped by two RFC 3161 authorities (DigiCert, FreeTSA), with tokens stored and checked against digest and nonce
- [x] Replay of snapshots in a tab (ReplayWeb.page, vendored) through signed, expiring links; archived scripts cannot use the API
- [x] `Watch` a URL on a schedule (claimed atomically across servers); `PageChange` documents with line diffs; Archive tab with change list, full diff, unseen count and before/after replays; changes in Activity
- [x] Evidence export: WACZ, text, screenshot, manifest, timestamp tokens, `SHA256SUMS`, custody record and `VERIFY.txt`; verified with `shasum` and `openssl ts -verify` in the end-to-end test
- [x] Query support: `sourcetype=snapshot archive=hvnt33`, `sourcetype=change` (with `added_text` / `removed_text`), Search Lab presets
- [x] Captures can snapshot their page ("Snapshot page", on by default); the agent's CLI reads snapshots, text, changes and diffs
- [x] Hosted-safe: private and loopback addresses refused in token mode (starting URL and every redirect); snapshots and watches metered (`snapshots.monthly`, `watches`)
- [ ] Watch a saved search (re-run on a schedule): needs licensed search APIs server-side, moved to Phase 6
- [ ] `| diff` query command: page diffs are in the Archive tab and `page-diff`; a query form can follow demand
- [ ] OpenTimestamps (Bitcoin-anchored) as a second proof type; desktop notifications for changes

Done when: a watched page that changes produces a dated, verifiable before/after record the researcher can export. Verified by the end-to-end test (a local page watched, its change recorded with a diff) and `npm run test:live` (a real page with both timestamp tokens verified by OpenSSL).

## Phase 5: Open-source release (in progress)

Engineering is done. What remains is the maintainer's: legal review, name clearance, signing credentials, and publishing. See [docs/releasing.md](docs/releasing.md); `npm run release:check` tracks the gate.

- [x] License: GNU AGPL v3 (`LICENSE`, every package); contributions use the same license without a separate CLA
- [x] Legal review of the AGPL-3.0 choice; proprietary cloud code remains separately implemented across a network API boundary
- [ ] Name clearance: domain, GitHub organization, package scopes and a trademark search for "hvnt33"
- [x] `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `SECURITY.md` (private vulnerability reporting), issue and pull request templates, Dependabot
- [x] CI (GitHub Actions, actions pinned to commits): verify on macOS, Windows and Linux; server integration tests on the built-in database in both modes on all three; API client drift check; `npm audit`; gitleaks (pinned binary). Live E2E as a manual workflow on a self-hosted Mac
- [x] Release workflow: installers for macOS (Apple Silicon, Intel), Windows and Linux through electron-builder (signed and notarized once the secrets are added), draft release. Local `npm run package` makes this platform's installer
- [ ] Apple Developer ID secrets; first signed release
- [ ] Auto-update (electron-updater; user-initiated checks only)
- [x] One app, everything built in: rebuilt on Electron (one Chromium engine on macOS, Windows and Linux; the interface moved to `packages/ui` unchanged); the server runs inside the app; ArcadeDB on a pinned Temurin Java runtime is built in and started by the server (`seams/database.ts`), with checksum-verified installs (`npm run runtime:fetch`, `runtime:update`); Tor built in. Docker is no longer used anywhere: snapshots are made in the app's browser, backups restore with the bundled ArcadeDB (`npm run restore`), and CI runs without service containers
- [x] Installed apps set up their own agent workspace (instructions, skills and a `hvnt33-research` command on the app's own Node); a checkout can still be chosen
- [x] Built-in Tor on macOS (Apple Silicon, Intel), Windows x86_64 and Linux x86_64, each bundle's GPG signature verified before pinning (the Tor Project publishes none for Windows or Linux on ARM)
- [ ] A smaller Java runtime (jlink with only the modules ArcadeDB uses) to shrink installers
- [x] Verification, editing, connections, map, timeline, capture review and exports in the desktop app (Case view), working with local and hosted servers; human reviews recorded apart from agent filing
- [ ] Retire or rebuild the original web workspace (still available in local mode)
- [x] Fictional demo investigation (`npm run demo`); README rewritten as an install and first-investigation guide
- [ ] Screenshots of the demo case for the README; documentation site
- [x] Personal notes untracked; history scanned (gitleaks, trufflehog: no secrets); publishing from a fresh history is documented and checked
- [x] No telemetry (checked by `release:check`)

Also added: per-case network routes (Tor, VPN SOCKS5 proxies, any proxy) with exit display, an exit lock that pauses the case, WebRTC removal, and snapshots captured through the case's route; verified end to end through a logging SOCKS5 proxy. Next for connections: built-in WireGuard per case (import a provider's config; no VPN app needed).

Also added: browser profiles (shared or per case, persistent logins, clearing) and open tabs saved per case, verified end to end including a relaunch.

Also fixed while preparing: snapshot replay now has its own origin, which restores the web workspace (blocked by the Phase 4 guard); fresh-database migrations; tests isolated in their own databases.

Done when: a stranger can install, run a search, capture a page and have the agent file it, following the README alone.

## Phase 6: hvnt33 Cloud

- [ ] Cloud implementations of the seams: OIDC auth, S3/R2 blobs, managed ArcadeDB, durable job queue and workers
- [ ] Sync: push/pull investigations between desktop and cloud; later continuous sync
- [ ] Managed archiving: scheduled watches and captures run by the cloud, change alerts by email or push
- [ ] Teams: shared workspaces, roles, activity audit log
- [ ] Sharing and publishing: read-only investigation links, published dossiers
- [ ] Billing: Stripe plans mapped to entitlements; usage metering (storage, snapshots, watches, seats, AI credits)
- [ ] Server-side search through licensed APIs (e.g. Brave Search API); no automated results-page scraping
- [ ] Compliance before launch: privacy policy, data processing terms, deletion and export on request, takedown and abuse handling, encryption at rest; optional client-side encryption for sensitive cases

**Pricing hypothesis** (to validate with users):

| Plan | For | Includes |
|---|---|---|
| Open source | Individuals, self-hosters | Everything local, unlimited |
| Personal | Solo investigators | Cloud sync and backup, N GB storage, M watched URLs |
| Pro | Working journalists, researchers | More storage and watches, evidence-grade exports, AI credits |
| Team | Newsrooms, NGOs | Shared workspaces, roles, audit log, SSO |
| Enterprise | Large organizations | Self-hosted cloud, SLAs, custom retention |

Done when: a user signs up, syncs an investigation from the desktop app, sets a watch, receives a change alert, and is billed correctly for usage.

## Phase 7: Web observatory

The long-term vision: the archive becomes a dataset for tracking how the web changes across many investigations.

- [ ] Opt-in contribution of public-page snapshots to a shared corpus (never private investigation data)
- [ ] Public change feeds for watched entities and domains
- [ ] Research API over the public corpus
- [ ] Legal review and governance model before launch (copyright, privacy law, takedown, abuse)

## Decisions needed

| Decision | Needed by | Recommendation |
|---|---|---|
| License | Phase 5 | Decided and reviewed: AGPL-3.0-only, without a CLA; private cloud services stay across a network API boundary |
| Name clearance for "hvnt33" | Phase 5 | Check domain, GitHub org, npm scope and trademarks now |
| Cloud provider | Phase 6 | Cloudflare R2 + a container platform; decide after Phase 3 |
| Public archive in scope? | Phase 7 | Private per-workspace archive first; public only with legal review |

## Risks

- **Search engines change their markup or block automation.** Mitigation: per-engine fixtures, live E2E diagnostics, the generic fallback extractor, and honest URL-quality labels. Recording what users view in their own browser is the defensible model; don't scrape from servers.
- **Archiving other people's pages has legal exposure.** Mitigation: private by default, deliberate publishing, takedown process before any public feature.
- **Sensitive investigations in the cloud.** Mitigation: local-first product, workspace isolation tests, encryption at rest, optional client-side encryption.
- **Contributor friction.** The server is now typed and documented (Phase 3); the original browser workspace is still dense JavaScript and is rebuilt before release (Phase 5).
