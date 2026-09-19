# Operations: storage, backup, security and tests

## Where things live

Everything hvnt33 writes at runtime is under `data/`, which Git ignores: in the repository when you run it from source, or in the app's data folder when an installed app has no workspace chosen. Set `HVNT33_DATA_DIR` to keep it elsewhere.

| Path | Contents |
|---|---|
| `data/arcadedb/databases/` | Persistent ArcadeDB databases. Records are graph vertices; relationships are real graph edges. |
| `data/arcadedb/config/` | The built-in database's users (the root password is set from `ARCADEDB_PASSWORD`, or generated into `data/secrets/`, on first start). |
| `data/arcadedb/instance.json` | While the built-in database runs: its process and port, so every hvnt33 process on this data shares one instance. |
| `data/arcadedb/backups/` | ArcadeDB native snapshots. |
| `data/arcadedb/log/` | ArcadeDB server logs (`server.out`). |
| `apps/server/vendor/runtime/` | The built-in database: ArcadeDB and the Eclipse Temurin Java runtime, installed by `npm run setup` after their SHA-256 match the pins in `apps/server/vendor/runtime.json`. Not in git; inside the installed app. |
| `data/vault/` | Original evidence files and snapshot files (archives, text, screenshots, manifests, timestamp tokens), content-addressed by SHA-256. Records hold file metadata and checksums; large media is served with range requests. |
| `apps/server/vendor/tor/` | Built-in Tor (the Tor Project's Expert Bundle), installed by `npm run setup` after its SHA-256 matches the pin in `apps/server/vendor/tor.json`. Not in git. |
| `data/tor/` | Built-in Tor's state (its cached view of the Tor network), private to your user. |
| `data/secrets/` | Logins for case routes (proxy usernames and passwords), readable by your user only. Not in the database, exports or recovery backups: re-enter them after restoring on another machine. |
| `data/tmp/` | Work directories for snapshots in progress; each is removed when its snapshot finishes. |
| `data/exports/` | Recovery ZIPs made with `npm run backup`. |
| `.env` | Local credentials and configuration (Git-ignored). `npm run setup` generates a random database password. Optional: `OPENAI_API_KEY`, and `ARCHIVE_ORG_ACCESS_KEY` / `ARCHIVE_ORG_SECRET_KEY` for "Archive now". |

The built-in database listens on a free port on this machine only (see `data/arcadedb/instance.json`); you never need to reach it directly. The server creates the database and indexes automatically.

## Server modes and configuration

The server runs in local mode by default. Token mode is the hosted shape: API tokens, isolated workspaces and plan limits. See [apps/server/README.md](../apps/server/README.md#modes) for `npm run admin` and plan configuration.

| Variable | Default | Purpose |
|---|---|---|
| `PORT`, `HOST` | `4310`, `127.0.0.1` | Where the server listens |
| `HVNT33_REPLAY_PORT`, `HVNT33_REPLAY_URL` | `PORT` + 1, `http://localhost:<port>` | The snapshot replay site: a second listener, on its own origin because replayed pages run archived scripts. Behind a proxy, give it its own hostname and set the URL browsers use |
| `HVNT33_AUTH` | `local` | `local` or `token` |
| `HVNT33_PLANS` | unlimited only | JSON plan limits for token mode |
| `HVNT33_ALLOWED_ORIGINS` | none | Extra browser origins allowed to call the API |
| `HVNT33_DATA_DIR` | `data/` | Runtime data location |
| `ARCADEDB_PASSWORD`, `ARCADEDB_DATABASE` | from `npm run setup` | The database password and name |
| `ARCADEDB_URL`, `ARCADEDB_USER` | unset | An ArcadeDB you run yourself (for example a managed one); unset uses the built-in database |
| `HVNT33_DATABASE_MEMORY` | `1G` | The built-in database's maximum Java heap |
| `HVNT33_RUNTIME_DIR` | `apps/server/vendor/runtime` | Where the built-in database is installed |
| `OPENAI_API_KEY`, `ARCHIVE_ORG_*` | empty | Optional in-app AI; "Archive now" |
| `HVNT33_CAPTURE` | `auto` | Snapshot method: `auto` (the app's browser when the server runs inside the app, else fetch) or `fetch` |
| `HVNT33_TSA_URLS` | DigiCert, FreeTSA | Comma-separated RFC 3161 timestamp authorities; every snapshot is stamped by each |
| `HVNT33_SECRET` | random per start | Signs replay links. Set it when several servers share a database, or to keep replay links valid across restarts |
| `HVNT33_EXIT_CHECK_URL` | `https://am.i.mullvad.net/json` | Service that reports where a case's traffic exits (country, city, network), checked through the case's route |
| `HVNT33_TOR_BUILTIN` | on | `0` turns built-in Tor off (then a running Tor Browser or tor service is used) |
| `HVNT33_TOR_PORTS` | `9150,9050` | Where to look for an already-running Tor: Tor Browser, then the tor service |
| `HVNT33_ALLOW_PRIVATE_URLS` | `1` in local mode, `0` in token mode | Whether snapshots may fetch private and loopback addresses |

The schema is versioned: migrations in `apps/server/src/db/migrations.ts` apply at startup (recorded in `SchemaMigration`), so upgrading is restarting the server. Take a backup first; migrations only add.

## Moving from the Docker database

Earlier versions ran ArcadeDB in Docker, on the same `data/arcadedb/databases/` folder. To move to the built-in database:

1. Quit the app and stop `npm start`, then stop the container so ArcadeDB closes its files: `docker stop hvnt33-arcadedb`.
2. Copy `data/arcadedb/databases/` aside as a backup.
3. Delete the `ARCADEDB_URL` and `ARCADEDB_USER` lines from `.env` (keep `ARCADEDB_PASSWORD`: the built-in database takes it on first start).
4. Start hvnt33. The built-in ArcadeDB opens the same files; it is a newer version and reads databases made by the old one.

When everything is there, remove the container and its configuration volume: `docker rm hvnt33-arcadedb` and `docker volume rm osint_arcade-config`.

## Updating the built-in database

`npm run runtime:update` pins the newest Temurin JRE and ArcadeDB release (checksums from Adoptium and ArcadeDB's GitHub releases), and `npm run runtime:fetch` installs them. Take a backup first, run `npm test`, then restart the app. ArcadeDB opens databases made by earlier versions.

## Snapshots: your own archive

A snapshot stores a page as a WACZ web archive, its readable text, a screenshot and a manifest of their SHA-256 hashes, and asks independent timestamp authorities to sign the manifest's hash. Snapshots are taken on request ("Snapshot now"), with a capture, or on a schedule for watched pages.

In the app, snapshots are made by its own browser: a hidden window loads the page in a fresh session (no cookies or sign-ins), through the case's route when it has one, and records every response it receives (the document, scripts, styles, images), then scrolls through the page so lazy content loads and takes a screenshot and the rendered text. The archive replays the page as it rendered. A snapshot takes 5 to 30 seconds. A server running without the app fetches only the page's HTML: text and change tracking work, but the archive has no images or styles and no screenshot, and the snapshot says so in its notes.

To check an evidence package without hvnt33, follow its `VERIFY.txt`: `shasum -a 256 -c SHA256SUMS`, then `openssl ts -verify` for each token. DigiCert tokens verify against the system CA bundle; FreeTSA publishes its CA at https://freetsa.org/files/cacert.pem. Timestamp requests send only a hash, never page content or URLs. If no authority can be reached, the snapshot is still stored and records why it has no timestamp.

A hosted deployment adds its own capture implementation (a headless browser on workers whose network cannot reach private addresses); the server itself refuses private addresses for the starting URL and every redirect of direct fetches.

## Make a recovery backup

```sh
npm run backup
```

This creates an ArcadeDB snapshot, then packs it with the evidence vault and a manifest into `data/exports/`. Originals are append-only, so the vault may include files captured after the database snapshot; files referenced by the snapshot are retained. A recovery ZIP contains private research. Keep a copy on separate storage. Presentation exports are portable components, not native database recovery backups.

## Restore without overwriting your current database

Quit the app (or stop `npm start`), then restore into a new database name:

```sh
npm run restore -- data/exports/hvnt33-backup-….zip newsroom_restored
```

It refuses a name that already exists and a database that is still running. Evidence files from the backup are added to `data/vault/`; files already there are kept (originals are append-only). Set `ARCADEDB_DATABASE=newsroom_restored` in `.env` and start hvnt33 again. Your original database remains available under its original name. Credentials are not in the recovery ZIP; the database keeps its own. The backup and restore round trip is checked against ArcadeDB's own restore tool, bundled with the built-in database.

## Security and scale

The server uses ArcadeDB's authenticated HTTP API; credentials stay on the server. IDs are uniquely indexed, and records, connections, intakes and search runs are indexed by investigation, so cases remain independently queryable. Uploads and exports stream to disk or network rather than holding whole files in memory. The graph display is bounded to 70 matching nodes; CSV and JSON exports include the complete selection.

This is a usable single-user version, not a benchmarked multi-user deployment. The web interface fetches a complete investigation and searches it locally. For very large cases, the next scaling work is server-side full-text search, paginated records, neighborhood graph queries, background ingestion and resumable uploads (see [ROADMAP.md](../ROADMAP.md)). There is no OCR, transcription, multi-user authentication, encryption layer or general edit-history ledger yet.

The server and the built-in database bind to localhost. Other users and processes on your machine can reach them; use a protected account and encrypted storage for sensitive work. Do not expose this version to the internet. The desktop app's own security model is described in [apps/desktop/README.md](../apps/desktop/README.md#security-model).

## Tests

| Command | What it checks | Needs |
|---|---|---|
| `npm test` | Server tests in both profiles (local and token) against a real ArcadeDB (a built-in database of their own per test file), with every response checked against the API contract: evidence, exports, sync, intake filing, search runs, visits, archive, tenancy isolation and plan limits. See [apps/server/README.md](../apps/server/README.md#tests). Removes only its own fixtures. | `npm run setup` (the tests start their own server and database) |
| `npm run test:core` | Query language, engines, URL normalization | Nothing |
| `npm run verify` | Typecheck of server, core, interface and app; server unit, core, interface and app tests; the app build | Nothing |
| `npm run release:check` | The pre-publication gate: license, no release placeholders, no private files or secrets in history, versions agree, no telemetry | gitleaks |
| `npm run test:live` | A real page archived by the server, timestamped by DigiCert and FreeTSA, with both tokens verified by OpenSSL; built-in Tor on the real network (two cases on different exits, New exit, a snapshot through Tor) | Internet; `npm run setup` |
| `npm run e2e` | Live app session (42 checks, including a relaunch) against real search engines, with the app running its own server and database as it does for a researcher: search, capture, Wayback, snapshot, replay, evidence (verified with `shasum` and `openssl ts`), watches and changes, the web workspace, per-case browser profiles and tabs across a relaunch, case routes through a logging SOCKS5 proxy and the kill switch, and isolation probes. `-- --token` runs it through an API token against a hosted-shape server; `-- --screenshots DIR` captures UI states. Its server, database and browser sessions live in temporary directories | Opens a window |

ArcadeDB integration follows the [official HTTP API](https://docs.arcadedb.com/arcadedb/reference/http-api/http) and [backup/restore documentation](https://docs.arcadedb.com/arcadedb/how-to/operations/restore). The built-in version is pinned in `apps/server/vendor/runtime.json`.
