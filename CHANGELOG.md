# Changelog

All notable changes to hvnt33. Dates are when the work was completed.

## Unreleased: preparing the first public release

- One app on macOS, Windows and Linux, with nothing else to install. The desktop app is rebuilt on Electron: the same interface (now `packages/ui`) and features, one browser engine everywhere. It runs its own server; the server starts a built-in ArcadeDB (26.9.1, on Eclipse Temurin 25, both checksum-verified) instead of Docker. `npm run package` builds an installer with the server, the database and Tor inside. Installed apps keep research in their data folder and set up their own agent workspace.
- Snapshots are made in the app's own browser: a hidden window loads the page through the case's route and records every response, with a screenshot and the rendered text. No crawler or Docker. A server without the app still archives the HTML.
- Captured images are fetched through the tab's own session, so through the case's route (they were fetched directly before). A paused case refuses every request of its tabs, not only navigations; routed tabs send loopback traffic through the route too.
- `npm run restore` restores a recovery backup into a new database with the bundled ArcadeDB.
- Docker removed: no `compose.yaml` or server image. To use your own ArcadeDB, set `ARCADEDB_URL`. To move existing research from the Docker container, see `docs/operations.md`.
- CI runs on macOS, Windows and Linux; release builds installers for all three.
- Built-in Tor on Windows (x86_64) and Linux (x86_64) as well as macOS, each bundle's Tor Browser Developers signature verified before its hash is pinned.

- Licensed under the GNU AGPL v3, with a code of conduct, security policy, contribution guide, and issue and pull request templates. Contributions use the project license without a separate CLA.
- Continuous integration: typecheck, unit and build checks; server integration tests in both server modes; secret scanning; a manual live end-to-end workflow; tagged releases build the app (signed when credentials are configured).
- `npm run release:check`: the gate before publishing.
- Snapshot replay moved to its own origin (a second port). This restores the web workspace, which the Phase 4 API guard had blocked.
- Release builds no longer embed the build machine's paths and ask for the hvnt33 folder on first run. The bundle identifier is now `dev.hvnt33.desktop`.
- `npm run demo` creates a fictional demo investigation.
- Tor built in: the Tor Project's tor (Expert Bundle 15.0.23, tor 0.4.9.12), installed by `npm run setup` after checking a SHA-256 pinned from GPG-verified releases (`npm run tor:update` verifies new ones); started when a case turns Tor on, with progress on the button, and stopped when no case uses it. Verified on the real Tor network (`npm run test:live`, `npm run e2e -- --real-tor`).
- Tor in one click per case, each case on its own circuit, with New exit. Proxies that need a username and password, through a local relay; logins kept only in a private file on this machine. Each route has its own cookie jar within the case. Exports leave out how the case connected.
- Connection per case: route a case through Tor, a VPN's SOCKS5 proxy or any SOCKS5/HTTP proxy (tabs, snapshots, watches and Wayback lookups; DNS through the proxy; fails closed), see its exit in the status bar, and lock it to an exit (the kill switch pauses the case when the VPN drops). WebRTC is removed from browsed pages. Snapshots record the route and exit (never the IP).
- The Case view (⌘4) in the desktop app: review and edit records, verification statuses, connections, the connection map (SVG export), the timeline, review of staged captures, and presentation exports, replacing the web workspace as the main place to verify. Reviews are recorded (`reviewedAt`, `reviewedBy`) apart from agent filing, and are queryable in the Search Lab.
- The release identity is filled in; `docs/release-checklist.md` tracks the remaining maintainer and signing work.
- Browser profiles: tabs keep cookies and logins across restarts, in a shared profile or a case's own (separate logins per case, the default for new cases). Each case keeps its open tabs, restored on launch and when switching back. Clear Browsing Data per profile. The end-to-end test uses throwaway profiles and storage. Requires macOS 14.
- Tests and the end-to-end session use their own databases and temporary data directories. Migrations were fixed for fresh installs.

## 2026-09-18: Phase 4, the web's memory, owned

Own snapshots (WACZ archive, text, screenshot) timestamped by two RFC 3161 authorities, replay, watches with change diffs, and evidence packages verifiable with `shasum` and `openssl`.

## 2026-09-18: Phase 3, cloud-ready core

TypeScript server with zod routes, an OpenAPI contract and a typed client; workspaces, API tokens, plan limits; versioned migrations; sync groundwork.

## 2026-09-18: Phase 2, the Wayback Machine as a source

Archive history beside every page, Save Page Now, archive events in the Search Lab.

## 2026-09-18: Phase 1, see everything as data

Results and page metadata in a panel beside the page, visits, saved searches, cross-engine comparison.

## 2026-09-18: Phase 0, foundation

The desktop workbench: every search engine at once, capture, the Search Lab query language, the agent terminal.
