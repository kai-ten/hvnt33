# HVNT33 desktop release checklist

This is the maintainer checklist for making HVNT33 downloadable as signed installers. The build automation already produces macOS Apple Silicon and Intel DMGs, a Windows NSIS installer, and Linux AppImage and Debian packages. A version tag opens a draft GitHub release; it does not publish automatically.

## Current state

- [x] Public repository identity: `kai-ten/hvnt33`
- [x] Code-of-conduct contact: `kai@hvnt33.com`
- [x] License: AGPL-3.0-only, with no contributor license agreement
- [x] Cross-platform release workflow exists
- [x] Runtime downloads and Tor bundles are pinned and verified
- [x] Current desktop and website release work committed
- [x] Fresh public history created at `https://github.com/kai-ten/hvnt33` (the private history remains private)
- [ ] Apple signing secrets installed in GitHub
- [ ] Windows signing approach chosen
- [ ] First draft release tested on clean machines

Do not upload the existing local DMG. It is an ad-hoc development build without an Apple notarization ticket. Rebuild it through the signed release workflow.

## 1. Complete the decisions only the maintainer can make

- [x] AGPL-3.0 choice reviewed with counsel on 2026-09-19; the proprietary cloud will remain separately implemented across a network API boundary.
- [ ] Complete a trademark/name search for “HVNT33” in every market where it will be sold.
- [x] Confirm continued ownership of `hvnt33.com` and the `kai-ten/hvnt33` GitHub repository.
- [ ] Decide whether the first release is the `v0.1.0` prerelease currently configured.
- [x] Include the current `apps/web` work in the first public repository.

Contributions are made under AGPL-3.0-only. There is no CLA bot or signature branch.

## 2. Prepare Apple signing and notarization

The Mac has two Developer ID Application certificates for the same team: one expires in 2027 and one in 2031. The 2031 certificate has its private key (labelled `LoreKit`), and `security find-identity -v -p codesigning` reports both Developer ID Application identities as valid. Do not delete either certificate until the 2031 pair is exported and a CI-signed build is verified.

```text
Developer ID Application: Kai Herrera (BR6J77ATNC)
```

- [x] In Keychain Access, open **My Certificates** and expand the 2031 Developer ID Application entry.
- [x] Confirm that the 2031 entry has an indented private-key child (`LoreKit`).
- [x] Run `security find-identity -v -p codesigning` and confirm it reports the Developer ID Application identities as valid.
- [ ] Export a backup before deleting anything. Only after the 2031 identity is usable may the expiring 2027 duplicate be removed.
- [ ] Export that pair as a password-protected `.p12`.
- [ ] Create an Apple app-specific password at appleid.apple.com.
- [ ] Confirm the Apple Team ID (`BR6J77ATNC` is present in the installed certificate).
- [ ] Encode the certificate locally:

```sh
base64 -i certificate.p12 | pbcopy
```

Never commit or paste the certificate, its password, or the Apple password into an issue or chat.

The Developer ID Installer certificate is not used for the current `.dmg` release. Keep it if a signed `.pkg` may be added later; it does not conflict with Developer ID Application signing.

## 3. Create and configure the public GitHub repository

- [x] Create the public repository at `kai-ten/hvnt33` from a clean one-commit history.
- [x] Enable **Security → Private vulnerability reporting**, secret scanning, push protection, vulnerability alerts, and Dependabot security updates.
- [ ] Protect `main` and require the CI checks before merging.
- [ ] Add these under **Settings → Secrets and variables → Actions**:

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
```

`APPLE_CERTIFICATE` is the base64 `.p12`. `APPLE_PASSWORD` is the app-specific password, not the normal Apple account password.

The workflow does not consume `APPLE_SIGNING_IDENTITY`; it is useful only for diagnosing local signing.

## 4. Choose Windows distribution signing

The current workflow can publish an unsigned `.exe`, but Windows SmartScreen will warn users and some managed computers will refuse it.

Choose one:

- [ ] Obtain an OV code-signing certificate delivered as `.pfx`, then add `WINDOWS_CERTIFICATE` (base64 `.pfx`) and `WINDOWS_CERTIFICATE_PASSWORD` to GitHub.
- [ ] Integrate Microsoft Artifact Signing before launch.
- [ ] Intentionally label `v0.1.0` as an unsigned Windows beta and document the warning.

An EV certificate no longer automatically bypasses SmartScreen, so do not buy EV solely for that purpose. Linux packages are currently unsigned.

## 5. Prepare a clean public history

The private repository contains `docs/notes` in its history. Never make this repository public. After all intended release files are committed, create a new history:

```sh
git clone --no-local . ../hvnt33-public
cd ../hvnt33-public
git checkout --orphan main-public
git commit -m "hvnt33: initial public release"
git branch -M main-public main
git remote remove origin
npm install
npm run release:check
git remote add origin git@github.com:kai-ten/hvnt33.git
git push -u origin main
```

Run this only after deciding which website changes belong in the release and committing the complete desktop work.

## 6. Run the release gates

Update both `package.json` files to the same version and move the applicable `CHANGELOG.md` entries out of Unreleased. Then run:

```sh
npm install
npm run verify
npm test
npm run e2e
npm run test:live
npm run release:check
```

All commands must pass in the clean public checkout. Investigate live-service timeouts rather than silently ignoring them.

## 7. Create the draft release

For the currently planned first version:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The Release workflow builds:

- macOS Apple Silicon `.dmg`
- macOS Intel `.dmg`
- Windows `.exe`
- Linux `.AppImage`
- Linux `.deb`

It then opens a **draft prerelease**. Do not publish it yet.

## 8. Test every draft installer

Use clean machines or fresh OS user accounts. For every platform:

- [ ] Installer opens and finishes.
- [ ] HVNT33 starts with no Node, Java, ArcadeDB, Tor, or Docker preinstalled.
- [ ] A new investigation can be created.
- [ ] Search, browser navigation, capture, Search Lab, and the agent terminal work.
- [ ] Quitting stops the bundled server/database.
- [ ] Reopening preserves cases, tabs, and the intended browser profile.
- [ ] Uninstalling behaves as documented and does not unexpectedly delete research.

On macOS also run:

```sh
codesign --verify --deep --strict --verbose=2 /Applications/HVNT33.app
spctl --assess --type execute --verbose=4 /Applications/HVNT33.app
xcrun stapler validate HVNT33-0.1.0.dmg
```

On Windows, verify the publisher with PowerShell:

```powershell
Get-AuthenticodeSignature .\HVNT33-Setup-0.1.0.exe | Format-List
```

## 9. Publish and link the download

- [ ] Add SHA-256 checksums for every installer to the draft release.
- [ ] Write release notes including supported platforms, known limitations, data location, and unsigned-platform warnings if any.
- [ ] Publish the GitHub release only after the installer matrix passes.
- [ ] Point the hvnt33.com Download page to the GitHub release assets and their checksums.
- [ ] Test the download instructions literally from a clean account.

Auto-update is not part of the first release. Add it only after public, signed releases are stable; update checks must remain user-initiated.
