# Security policy

hvnt33 holds sensitive research: private investigations, evidence files and notes about real people. Security reports are welcome and taken seriously.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue, pull request or discussion for a suspected vulnerability.

Include what you found, how to reproduce it, the version or commit, and the impact you believe it has. You will get an acknowledgement within 5 working days, and we will keep you informed until it is fixed. We credit reporters in the release notes unless you prefer otherwise.

## Scope

In scope:

- The desktop app (`apps/desktop`): browsed pages gaining app capabilities or reaching the terminal, the file system or the API token; navigation-policy bypasses.
- The server (`apps/server`): authentication and workspace isolation in token mode, access to another workspace's data, path traversal in the evidence vault, server-side request forgery in snapshots, replay-link forgery, archived pages reaching the API.
- Evidence integrity: ways to alter stored evidence, manifests or timestamp tokens without detection.
- The research CLI and agent workflow: page content causing the agent terminal to run commands.

Out of scope: vulnerabilities in search engines or the Internet Archive, social engineering, denial of service against a local server, and issues that need an attacker who already controls your user account.

## Security model

The design is described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#trust-boundaries) and [apps/desktop/README.md](apps/desktop/README.md#security-model). The local server trusts requests from your own machine; do not expose it to a network. Token mode is the hosted shape.

## Supported versions

Before 1.0, only the latest release receives security fixes.
