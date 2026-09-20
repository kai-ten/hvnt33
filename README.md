# hvnt33

An investigation workbench. Search every engine at once, read and capture evidence without leaving the app, and let an AI agent file it into a graph of people, organizations, events and claims, with every finding traceable to its source.

- **Search every engine.** DuckDuckGo, Bing and Brave are selected initially; Google, Startpage, Mojeek and Yandex are one click away. Each results page you see is recorded: engine, query, rank, title, URL, snippet and time.
- **Search Lab.** A Splunk-style query language over everything you have seen and kept: `sourcetype=serp | compare`, `| changes`, `stats count by domain`.
- **Capture in one keystroke.** Highlight text, or point at an image, and press ⌘⇧S. The selection, citation metadata and image original are saved as evidence.
- **Web archive.** Every page shows its Wayback Machine history (versions, first and last capture, the version nearest publication). With a free archive.org account, one click archives the page you're reading.
- **Your own archive.** Snapshot any page as a replayable web archive with a screenshot, timestamped by independent authorities. Watch pages on a schedule and see exactly what changed. Export evidence that anyone can verify with `shasum` and `openssl`.
- **Agent terminal.** Claude Code or Codex in the same window files captures into ArcadeDB records and connections. Agent-filed stays Unverified until you check it.
- **Local-first, all in one app.** The server, the ArcadeDB database and Tor are built into the app. Your data lives on your machine in ArcadeDB and a checksummed evidence vault. Nothing else to install, no Docker.
- **Cloud-ready.** The same app can connect to a hosted hvnt33 server with an API token (File › Connect to Server…).

## Install

hvnt33 is one desktop app for macOS, Windows and Linux: the browser, the server, the database (ArcadeDB on a bundled Java runtime) and Tor, in one download. Published signed releases appear on the [Download page](https://hvnt33.com/download); to build it from source, you need:

- **Node.js 22.18 or later** (`node --version`)
- **Claude Code** or **Codex** for the agent that files your captures (optional, but it's how material becomes research)

```sh
git clone https://github.com/kai-ten/hvnt33.git hvnt33
cd hvnt33
npm install
npm run setup      # writes .env; verifies Electron; installs the database and Tor (checksum-verified)
npm run desktop    # builds and opens the app; it starts its server and database itself
npm run demo       # optional: a fictional demo investigation to explore
```

`npm run package` builds an installer for your platform (`.dmg`, `.exe` or AppImage and `.deb`) in `apps/desktop/release`.

## First investigation

1. In the desktop app, create an investigation in the right-hand pane: what you're investigating, and the question you want to answer.
2. Press ⌘K and search. Every selected engine opens in its own tab, and each results page is recorded. The panel beside the page (⌘3) shows the results as data.
3. Open a result, highlight a passage and press ⌘⇧S. The capture is saved to the case and a reference to it appears in the agent's message at the bottom: add a note if you like ("connect this to the contract") and press Enter. You can also drag files from anywhere onto the agent. The agent reads the capture and files people, organizations, events and claims into the case, each with the exact quote it came from.
4. Watch the case grow in the investigation pane. Everything the agent files is **Unverified** until you review it: press ⌘4 for the Case view, tick **Needs review**, check each record against its quoted source, and set its status. Your reviews are recorded apart from the agent's filing.
5. Press ⌘2 for the Search Lab: `sourcetype=serp | compare` shows which results the engines agree on.

[Using hvnt33](docs/using-hvnt33.md) covers verification and exports; the [desktop guide](apps/desktop/README.md) covers every feature and shortcut.

### Running the server on its own

The app runs its server for you. To run the server without the app (for example on another machine the app connects to), use `npm start`: it starts the built-in database too. Snapshots made by a server without the app store each page's HTML and text but no screenshot, since the page is rendered by the app's browser. Keep the server on localhost: local mode trusts every request from the machine. For a shared server, use token mode; see [Operations](docs/operations.md#server-modes-and-configuration). To use an ArcadeDB you run yourself, set `ARCADEDB_URL` in `.env`.

## Repository layout

```
apps/
  desktop/    The app (Electron): browser, capture, snapshots, agent terminal; runs the server and database
  server/     Node server: ArcadeDB access, evidence vault, intake, search runs, archive, research CLI
  web/        The hvnt33.com website
packages/
  ui/         The app's interface (React) and the scripts it runs in browsed pages
  core/       Shared TypeScript: engines, result normalization, research events, query language
  api-client/ Typed client generated from the server's OpenAPI contract
docs/         Guides, architecture and working notes
data/         Runtime data (git-ignored): ArcadeDB files, evidence vault, exports
.agents/      Agent skills (Codex); linked into .claude/ for Claude Code
AGENTS.md     Standing instructions for the research agent (CLAUDE.md imports it)
ROADMAP.md    Where hvnt33 is going
scripts/      Repository tools: built-in database and Tor installs, the demo case, the release check
```

## Documentation

- [Using hvnt33](docs/using-hvnt33.md): investigations, verification and exports
- [Desktop app](apps/desktop/README.md): search, capture, Search Lab, shortcuts, security model
- [Agent workflow](docs/agent-workflow.md): how the agent files material, the research CLI, skills
- [Operations](docs/operations.md): storage, backup and restore, security, tests
- [Architecture](docs/ARCHITECTURE.md): how it fits together today and the cloud-ready design
- [Roadmap](ROADMAP.md)
- [Contributing](CONTRIBUTING.md), [Security policy](SECURITY.md), [Code of conduct](CODE_OF_CONDUCT.md)

## Research integrity

Filing is organization, not fact verification. hvnt33 preserves sources, attribution, uncertainty and contradictions; verification statuses are your editorial judgement. Observed search results record what an engine showed you, not the truth of what it links to.

## Privacy

hvnt33 has no telemetry and no accounts. Your research stays on your machine. Each case can browse with its own cookies and logins, so sites can't link your activity across cases. It contacts other services only to do what you ask, as described in [Architecture](docs/ARCHITECTURE.md#trust-boundaries): the search engines you use, the Internet Archive (Wayback lookups, which you can switch off), the timestamp authorities (they receive only a hash), and the AI agent you run in the terminal.

## License

hvnt33 is free software under the [GNU Affero General Public License v3](LICENSE). If you run a modified version as a network service, you must offer its source to its users. Contributions are submitted under the same license; no contributor license agreement is required.

hvnt33 includes [ReplayWeb.page](https://github.com/webrecorder/replayweb.page) (AGPL-3.0) by Webrecorder, [ArcadeDB](https://arcadedb.com) (Apache-2.0), the [Eclipse Temurin](https://adoptium.net) Java runtime (GPL-2.0 with the Classpath Exception) and [Tor](https://www.torproject.org) (BSD-3-Clause).
