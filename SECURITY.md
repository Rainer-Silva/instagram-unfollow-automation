# Security Policy

## Reporting security issues

Do not publicly disclose vulnerabilities involving:

- Credential exposure
- Session-cookie exposure
- Arbitrary command execution
- Arbitrary file access
- Dashboard exposure
- Unsafe unfollow targeting

If GitHub private security advisories are enabled for this repository, open a private security advisory. If advisories are not enabled, avoid posting exploit details publicly; open a minimal issue asking the maintainer to enable a private reporting channel.

## Local security model

The dashboard is intended to listen only on `127.0.0.1`. Do not expose it through public tunnels, reverse proxies, shared networks, or cloud hosting.

Local files can contain sensitive data, including logs, screenshots, reports, allowlists, `.env`, state, and browser session cookies. Review `.gitignore` before sharing or publishing changes.
