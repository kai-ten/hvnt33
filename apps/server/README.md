# @hvnt33/server

The hvnt33 API: investigations, records and connections (a graph in ArcadeDB), evidence originals, intake and filing, observed search runs, page visits, saved searches and the web archive. TypeScript run directly by Node (22.18+ strips types; there is no build step).

```sh
npm start            # from the repository root: local mode on http://localhost:4310
npm run research -- … # the agent's CLI
npm run admin -- …    # workspaces and API tokens (token mode)
npm run openapi       # regenerate packages/api-client from the routes
```

## Layout

| Path | What |
|---|---|
| `src/main.ts` | Entry point: config, migrations, job queue, listen |
| `src/app.ts` | Assembles the server for a configuration; middleware, errors, health, OpenAPI |
| `src/http.ts` | Route registry: zod-validated inputs, OpenAPI generation, contract checking |
| `src/config.ts` | Environment → configuration (modes, plans, data paths) |
| `src/db/migrations.ts` | Versioned ArcadeDB migrations, applied at startup with a cross-server lock |
| `src/seams/` | Deployment seams: `auth`, `entitlements`, `blobs`, `graph`, `jobs` |
| `src/domain/` | Routes and rules: investigations, intake, searches, visits, archive, exports |
| `scripts/` | `research.ts` (agent CLI), `admin.ts`, `backup.ts`, `setup.ts`, `openapi.ts` |
| `tests/` | Unit, API (both profiles), tenancy; see below |
| `public/` | The original browser workspace served at `/` |

## Modes

| | Local (default) | Token (hosted shape) |
|---|---|---|
| Set with | `HVNT33_AUTH=local` | `HVNT33_AUTH=token` |
| Who | The researcher on this machine | Bearer API tokens, one workspace each |
| Access checks | Loopback host only; foreign browser origins refused | Token required (except `/api/health`, `/api/openapi.json`); origins refused |
| Workspace | `local` | The token's workspace; every query is scoped to it |
| Limits | None | The workspace's plan (`HVNT33_PLANS`) |

```sh
HVNT33_AUTH=token HVNT33_PLANS='{"free":{"limits":{"investigations":3,"captures.monthly":200,"archive.saves.monthly":20,"storage.bytes":1073741824}}}' npm start
npm run admin -- create-workspace --name "Newsroom" --plan free
npm run admin -- create-token --workspace WORKSPACE_ID --user reporter@example.org
```

Tokens are shown once; only their SHA-256 is stored. A request over a plan limit gets `402` with `code: "limit_reached"` and the metric, limit and usage. `GET /api/workspace` reports usage.

## API contract

Every route is declared once in `src/domain/*` with zod schemas for its path, query, body and response. The same declarations:

- validate requests (400 with the first problem),
- produce `GET /api/openapi.json` (OpenAPI 3.1),
- generate the typed client in `packages/api-client` (`npm run openapi`),
- and, in tests, check every JSON response against its schema (`HVNT33_CONTRACT_CHECK=1`).

Errors are `{ "error": "...", "code": "...", "details": {...} }`.

## Tests

`npm test` (repository root) runs every test file twice, once per profile, against a real ArcadeDB and an in-process server on a free port:

- `unit.test.ts`: validation, extraction checks, Wayback parsing, Save Page Now (simulated), job queue, CSV, route registry.
- `api.test.ts`: the whole API in both profiles, with contract checking: evidence and exports, content-addressed dedupe, sync changes and tombstones, intake filing (including a forced mid-transaction failure), search runs, visits, saved searches, archive routes, OpenAPI coverage.
- `tenancy.test.ts`: local-mode host protection; token-mode authentication and revocation, 31 cross-workspace probes that must all return 404, and plan limits.
- `snapshots.test.ts`: the own archive. RFC 3161 parsing against real DigiCert and FreeTSA tokens (wrong digest and nonce rejected), replay-link signing and expiry, text diffs, WACZ writing (CDXJ offsets, package hashes), the private-address guard (including redirects), and through the API against a local page that changes: snapshots, change detection and diffs, evidence packages (checksums and manifest), watches (schedule, pause, one claim when servers race), capture-linked snapshots, replay links, API refusal to web pages, and in token mode 12 cross-workspace probes and plan limits. Pages are archived by fetch and timestamps are simulated as unavailable, so the tests run offline.
- `live.test.ts` (`npm run test:live`, skipped otherwise): a real page archived by the server, timestamped by both authorities, with both tokens verified by `openssl ts -verify`; built-in Tor on the real network. Snapshots in the app's browser are checked by the app's `npm run e2e`.
- `migrations.test.ts`: a fresh database migrates to the latest schema.

Each test file runs against a built-in database of its own in a temporary folder (or the ArcadeDB named by `ARCADEDB_URL`).

Tests clean up only what they create; files go to a temporary data directory, never `data/vault`.
