# Releasing hvnt33

## Before the first public release

Work through [the release checklist](release-checklist.md) in order. `npm run release:check` shows what is still missing. The public repository is `kai-ten/hvnt33`, and code-of-conduct reports go to `kai@hvnt33.com`.

### A. Decisions and reviews

| # | Task | Done when |
|---|---|---|
| A1 | **Legal review** of AGPL-3.0 for your business model | Complete 2026-09-19; contributions use AGPL-3.0 without a separate CLA, and proprietary cloud code stays across a network API boundary |
| A2 | **Name clearance** for "hvnt33": the domain, GitHub name, and a trademark search where you'll sell | You own the domain and GitHub name, and the search found no conflict |
| A3 | **Apple Developer account** | You can create and export a *Developer ID Application* certificate (section B) |

### B. GitHub repository secrets (for signed, notarized macOS builds)

Add these in the public repository under **Settings › Secrets and variables › Actions › New repository secret**:

| # | Secret name | What to enter | Where to get it |
|---|---|---|---|
| B1 | `APPLE_CERTIFICATE` | Your *Developer ID Application* certificate and private key, exported as a `.p12` file and base64-encoded | Keychain Access → right-click the certificate → Export → `.p12`; then `base64 -i cert.p12 \| pbcopy` |
| B2 | `APPLE_CERTIFICATE_PASSWORD` | The password you chose when exporting the `.p12` | You set it in B1 |
| B3 | `APPLE_ID` | The email of your Apple developer account | Your Apple account |
| B4 | `APPLE_PASSWORD` | An **app-specific** password (not your Apple ID password) | appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| B5 | `APPLE_TEAM_ID` | Your 10-character team ID | developer.apple.com → Account → Membership details |

Without them, releases still build but are unsigned: macOS then opens the app only after right-click → Open.

### C. Publish

| # | Step | How |
|---|---|---|
| C1 | Commit the release work in this private repository | Include the final desktop changes and decide whether the website ships with them |
| C2 | Create the empty `kai-ten/hvnt33` public repository | github.com/new (no README or license: they come from here) |
| C3 | Push a fresh history, without private notes | Use the commands below |
| C4 | Turn on **Security › Private vulnerability reporting** and protect `main` | GitHub settings |
| C5 | Add the secrets from B | GitHub settings |

```sh
git clone --no-local . ../hvnt33-public && cd ../hvnt33-public
git checkout --orphan main-public
git commit -m "hvnt33: initial public release"
git branch -M main-public main
git remote remove origin
npm install && npm run release:check        # must pass here
git remote add origin git@github.com:kai-ten/hvnt33.git
git push -u origin main
```

Keep this repository private: it holds the full history, including `docs/notes/`. After publishing, work in the public one.

## Signing and notarization

electron-builder signs the macOS app (hardened runtime, with the entitlements the Java runtime and V8 need) with the Developer ID certificate and notarizes it with Apple using the secrets in section B. Windows installers are signed when `WINDOWS_CERTIFICATE` (base64 `.pfx`) and `WINDOWS_CERTIFICATE_PASSWORD` are set; without a certificate Windows SmartScreen warns on first run. Linux packages are not signed. Without the secrets the workflow still builds, unsigned.

## Cutting a release

0. Check for a newer built-in database: `npm run runtime:update` pins the newest Temurin JRE and ArcadeDB (checksums from Adoptium and ArcadeDB's releases); then `npm run runtime:fetch`, `npm test` and `npm run e2e`. Check for a newer Tor (https://blog.torproject.org, Tor Browser releases): `npm run tor:update -- <version>` verifies the Tor Browser Developers' GPG signatures and pins the new bundle; then `npm run tor:fetch` and `npm run test:live`. Tor security releases are worth a release of their own.
1. Update the version in `package.json` and `apps/desktop/package.json` (the release check requires them to agree), and describe the changes in `CHANGELOG.md`.
2. `npm run verify`, `npm test`, `npm run e2e`, `npm run test:live`, then `npm run release:check`.
3. Tag and push, for example: `git tag v0.1.0 && git push origin v0.1.0`.
4. The *Release* workflow re-runs CI, builds the installers (macOS Apple Silicon and Intel `.dmg`, Windows `.exe`, Linux AppImage and `.deb`, each with the server, the built-in database and Tor inside), and opens a **draft** stable release. It also attaches the update ZIP, blockmaps and architecture-specific manifests. Download each build, check it opens, starts its server and shows a case, then publish the draft. Drafts are invisible to installed apps; publishing is what makes the version available.

Local builds: `npm run package` makes this platform's installer in `apps/desktop/release/` (`node apps/desktop/scripts/package.ts --dir` for an unpacked app only). With a Developer ID certificate in your keychain it is signed with it; `CSC_IDENTITY_AUTO_DISCOVERY=false` builds unsigned.

## Desktop updates

Installed apps check the public GitHub release after launch. A newer signed payload downloads without interrupting the investigation; the app then offers **Restart and install**. That action stops the agent terminal, server and embedded database before applying the update and relaunching. macOS uses a signed ZIP, Windows uses NSIS, and Linux uses the installed AppImage or Debian package (the `.deb` path shows the operating system's elevation prompt). GitHub release drafts and prereleases are not offered to stable installations.

The version being published must be greater than the installed version, and all update metadata files from the workflow must remain attached to the release. Never replace an already-published asset in place; cut a new version instead.

## Not yet

- **Tor on Windows and Linux for ARM.** The Tor Project publishes no Expert Bundle for them; those builds offer proxies and a Tor Browser you run.
