# To do

What's left before HVNT33 and hvnt33.com go public, in rough order. Tick items off as you go. Details live in the linked docs; this file is the checklist.

## 1. Decide where the website work goes

- [x] Keep the website with the desktop app in the first public repository; its full release gate passes locally.
- [x] Keep the pyramid-and-eye mark, `/icon.svg`, and the current brand-guide edits.

## 2. Put hvnt33.com online (Vercel)

See `docs/website/site-spec.md`.

- [ ] Create a Vercel project from `github.com/kai-ten/hvnt33`, **Root Directory: `apps/web`**. `apps/web/vercel.json` sets the build, the output folder and the security headers.
- [ ] Point the domain `hvnt33.com` at the project (DNS records Vercel lists). Add CAA records naming only Vercel's certificate authority, and turn on DNSSEC at the registrar.
- [ ] On the first preview deployment, check what a local server can't prove:
  - [ ] the response headers are there (`curl -I https://<preview>/`: `Content-Security-Policy`, `Strict-Transport-Security`, `Permissions-Policy` and the rest);
  - [ ] the browser console shows no Content-Security-Policy errors on the home page, a docs page and Investigations;
  - [ ] `/api/newsletter` answers (it says the newsletter isn't set up until step 3 is done).
- [ ] Once the site is stable, submit hvnt33.com to the HSTS preload list (hstspreload.org).
- [ ] Renew the expiry date in `apps/web/public/.well-known/security.txt` before 2027-09-18.

## 3. Turn on the newsletter (Resend)

See "Investigations and the newsletter" in `docs/website/site-spec.md`.

- [ ] Create a Resend account. Add the domain **hvnt33.com** and add the DNS records it gives you (SPF, DKIM, and a DMARC record if you don't have one). Wait for it to show as verified.
- [ ] In the domain's settings, **turn off open tracking and click tracking**, so the emails match the privacy page.
- [ ] Create a segment for the newsletter (Audience, Segments), for example "Investigations", and copy its ID.
- [ ] Create an API key with **full access**.
- [ ] In the Vercel project (Settings, Environment Variables), set:
  - `RESEND_API_KEY`
  - `RESEND_SEGMENT_ID`
  - `NEWSLETTER_FROM`, for example `HVNT33 Investigations <investigations@hvnt33.com>`
  - `NEWSLETTER_SECRET`, from `openssl rand -base64 32` (keep it; changing it voids unconfirmed links)
  - `SITE_URL` = `https://hvnt33.com`
- [ ] Put the same values in `apps/web/.env.local` (git-ignored; see `apps/web/.env.example`) so you can send from your machine.
- [ ] Redeploy, then subscribe with your own address on the live site: confirm the email arrives, the link lands on "You're subscribed", and you appear in the segment.
- [ ] If the form is ever abused (it can send one confirmation email per address per day), add a rate limit rule for `/api/newsletter` in Vercel's firewall.

### Publishing an investigation

1. Copy `apps/web/content/investigations/_example.md` to a new file, e.g. `2026-10-port-contracts.md` (the name becomes the address).
2. Write it with `draft: true`; see it at `npm run dev -w @hvnt33/web`.
3. Remove `draft: true`, run `npm run check -w @hvnt33/web` (the writing rules apply: no em dashes, no exclamation marks), commit and push. Vercel publishes it.
4. `npm run newsletter -w @hvnt33/web -- preview <slug>` to look at the email, then `-- send <slug>`: it appears in Resend as a **draft broadcast**. Review it there and press Send. (`--now` skips the draft.)

## 4. Finish the public-release review

The repository and conduct-contact fields are filled. There is no contributor license agreement; contributions use AGPL-3.0-only. `npm run release:check` shows what remains.

- [x] Counsel approved AGPL-3.0 for the public desktop/server code on 2026-09-19; the proprietary cloud remains separately implemented across network APIs.
- [ ] Name clearance: you own hvnt33.com and the GitHub name; run a trademark search for "hvnt33" where you'll sell.
- [ ] Follow section D of `docs/releasing.md` to publish a fresh public history.

## 5. Sign the desktop app

Unsigned builds work, but macOS makes people right-click and choose Open, and Windows SmartScreen warns "Windows protected your PC". Signing removes both. The *Release* workflow (`.github/workflows/release.yml`) signs automatically once the secrets below are set, and still builds unsigned without them.

### macOS: Developer ID signing and notarization

The app is built by electron-builder with the hardened runtime and `apps/desktop/build-resources/entitlements.mac.plist` (the bundled Java runtime and V8 compile code at run time). With the secrets set, electron-builder signs the app with your Developer ID certificate and has Apple notarize it.

- [ ] **Join the Apple Developer Program** ($99 a year, developer.apple.com/programs). Enrolling as an organization needs a D-U-N-S number; as an individual, the certificate carries your personal name.
- [ ] **Create the certificate.** On your Mac: Keychain Access, Certificate Assistant, *Request a Certificate From a Certificate Authority* (save to disk). Then at developer.apple.com, Certificates, **+**, *Developer ID Application*, upload the request, download the certificate and double-click it to install it with its private key.
- [ ] **Export it for CI.** In Keychain Access, find *Developer ID Application: <name> (<team id>)*, right-click, Export, save as `.p12` with a strong password. Then `base64 -i cert.p12 | pbcopy`. Delete the `.p12` file afterwards.
- [ ] **Create an app-specific password** at account.apple.com, Sign-In and Security, App-Specific Passwords (for notarization; your Apple ID password won't work).
- [ ] **Find your Team ID**: developer.apple.com, Account, Membership details (10 characters; also in brackets in the certificate's name).
- [ ] **Add the GitHub secrets** in the repository (Settings, Secrets and variables, Actions):

  | Secret | Value |
  |---|---|
  | `APPLE_CERTIFICATE` | the base64 of the `.p12` |
  | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` password |
  | `APPLE_ID` | your Apple developer account's email |
  | `APPLE_PASSWORD` | the app-specific password |
  | `APPLE_TEAM_ID` | the Team ID |

  `docs/releasing.md` also lists `APPLE_SIGNING_IDENTITY`; the workflow doesn't use it (electron-builder takes the identity from the certificate), so it can be skipped, and the doc should be corrected.
- [ ] **Check a signed build.** Download the `.dmg` from the draft release, install, then:

  ```sh
  codesign --verify --deep --strict --verbose=2 /Applications/HVNT33.app
  spctl --assess --type execute --verbose /Applications/HVNT33.app   # expect: accepted, source=Notarized Developer ID
  xcrun stapler validate /Applications/HVNT33.app                  # the notarization ticket is attached
  ```

  Then open it normally (double-click, no right-click needed) and check it starts its server and shows a case.
- [ ] **Local signed builds** (optional): with the certificate in your keychain, `npm run package` signs with it; add `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` to the environment to notarize too. `CSC_IDENTITY_AUTO_DISCOVERY=false npm run package` builds unsigned.

### Windows: code signing

The workflow signs with `WINDOWS_CERTIFICATE` (a base64 `.pfx`) and `WINDOWS_CERTIFICATE_PASSWORD`. **That route is mostly closed now:** since June 2023, publicly trusted code signing certificates are issued only on hardware tokens or cloud HSMs, so a new certificate can't be exported as a `.pfx`. Choose one of these and adapt the workflow:

- [ ] **Azure Trusted Signing** (Microsoft's managed service, a monthly fee): identity-validated signing without a hardware token, and supported by electron-builder (`win.azureSignOptions`). Check its current eligibility for individuals and organizations in your country before choosing it.
- [ ] **Or a certificate from a CA with cloud signing** (for example DigiCert KeyLocker or SSL.com eSigner), used from CI through the CA's signing tool.
- [ ] Either way, update `release.yml` and the "Signing and notarization" section of `docs/releasing.md` to match, and remove the `.pfx` secrets.
- [ ] **Check a signed installer** on Windows: right-click the `.exe`, Properties, Digital Signatures shows your name; or `Get-AuthenticodeSignature '.\HVNT33 Setup <version>.exe'` in PowerShell reports `Valid`. A new certificate still builds SmartScreen reputation over the first downloads.

### Linux

- [ ] Nothing required: AppImage and `.deb` aren't signed. Later, if you host an apt repository, sign it with a GPG key and publish the public key.

## 6. Website polish

- [ ] **Screenshots.** The features have no product images yet. Open the fictional demo case (`npm run demo`), take window screenshots of: search results with the data panel, a capture, the Search Lab comparing engines, the case map, the archive panel. Put them in `apps/web/assets/shots/` and list them in `assets/shots/manifest.json` (see `apps/web/scripts/images.ts`). Demo data only: no real people, no personal tabs or terminal.
- [ ] Check the Features and Get started copy against the desktop app as it is now (for example, the agent terminal now sits across the bottom of the window by default).
- [ ] Rebuild the app icons if the mark changes: `node apps/web/scripts/mark.ts --install` writes the favicon and `apps/desktop/build-resources/` icons.

## 7. Later

- [ ] **Auto-update** with electron-updater, once releases are public and signed; checks user-initiated, never in the background (see `docs/releasing.md`, "Not yet").
- [ ] A welcome email for new subscribers (Resend can send one when a contact joins the segment).
