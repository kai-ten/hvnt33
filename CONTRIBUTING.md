# Contributing to hvnt33

Thanks for helping. hvnt33 is used for real investigations, so the bar is: correct, tested, and honest about what it knows.

## Before you start

- For anything larger than a small fix, open an issue first so we can agree on the approach.
- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the pieces fit, and [ROADMAP.md](ROADMAP.md) for what is planned.
- Security problems go through [SECURITY.md](SECURITY.md), never a public issue.
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

hvnt33 is licensed under the [GNU AGPL v3](LICENSE). By submitting a contribution, you agree to license it under the same terms. No contributor license agreement is required.

## Set up

Requires Node.js 22.18+ on macOS, Windows or Linux. Nothing else: the database (ArcadeDB on a Java runtime) and Tor are downloaded, checksum-verified, by `npm run setup`.

```sh
npm install
npm run setup            # .env with a random database password; the built-in database and Tor
npm run desktop          # the app; it starts its server and database
npm start                # or: the server alone, at http://localhost:4310
```

## Checks

| Command | Run it when |
|---|---|
| `npm run verify` | Always. Typecheck, unit tests (server, core, interface, app), the app build. |
| `npm test` | You touch the server. Integration tests in local and token modes, each against a built-in database of its own in a temporary folder, never your research. |
| `npm run e2e` | You touch the app, search engines, capture or snapshots. Opens a window and drives a real session; the app runs its own server and database in temporary folders. |
| `npm run test:live` | You touch snapshots, timestamps or Tor. Real pages, real timestamp authorities and the real Tor network. |

CI runs `verify` and `npm test` on every pull request; the E2E test runs on demand, because it uses live search engines.

## Conventions

- **Match the code around you**: naming, comment density and idiom. The server is TypeScript run directly by Node (no build step), so use only erasable syntax (no enums or parameter properties).
- **Routes** are declared with zod in `apps/server/src/domain/*`. The same declaration validates requests, produces the OpenAPI contract and checks responses in tests. After changing one, run `npm run openapi` to regenerate `packages/api-client`.
- **Migrations** in `apps/server/src/db/migrations.ts` only add, and never change behavior once released. A migration names the types that existed when it was written; `tests/migrations.test.ts` migrates a fresh database.
- **Workspaces**: every owned document carries `workspaceId`, and every query filters by it. New id-taking routes need a cross-workspace probe in the tenancy tests.
- **Metered work** calls `entitlements.require` before and `entitlements.record` after. Never branch on plan names.
- **Web pages are untrusted.** Browsed tabs are sandboxed views with no bridge to the app; the app reads pages only through the bundled read-only scripts in `packages/ui/page-scripts/`, and answers commands only from its own view. Page content must never reach the terminal.
- **The interface is engine-agnostic.** `packages/ui` talks to the native side only through the bridge it is mounted with (`src/lib/native.ts`); native code lives in `apps/desktop/src/main`.
- **Tests own their fixtures** and clean up only what they created. Use fictional people, organizations and places in fixtures and examples, never real private individuals.
- **Search engines change.** When one breaks, capture what it rendered (`HVNT33_E2E_VERBOSE=1 npm run e2e`) and add a fixture-based test with the fix.

## Pull requests

- One logical change per pull request, with tests.
- Describe what changed, why, and how you verified it (commands and results). Say what you did not test.
- Update the docs a user or contributor would read to learn about the change.
- Keep dependencies current and pinned by the lockfile; justify new ones.

## Research integrity

hvnt33 helps people make claims about the world. Features must preserve sources, attribution, uncertainty and provenance, keep facts, allegations and inference distinct, and never upgrade verification on their own. See [AGENTS.md](AGENTS.md).
