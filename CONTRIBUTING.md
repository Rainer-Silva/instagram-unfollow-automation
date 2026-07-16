# Contributing

Thanks for considering a contribution.

## Safety expectations

This project automates browser interactions with Instagram and can affect real accounts. Contributions should preserve conservative defaults and avoid increasing account risk.

Before opening a pull request:

- Keep dry-run as the default.
- Do not add password storage or credential automation.
- Do not add cloud hosting or remote execution paths.
- Keep the dashboard bound to `127.0.0.1`.
- Keep live unfollowing behind explicit confirmation.
- Add or update tests for validation, targeting, and safety-stop behavior.

## Development

```bash
npm install
npm test
npm run check
```

Use a dedicated local Chrome automation profile for manual testing. Do not commit `.env`, logs, reports, screenshots, state files, or browser profile data.

## Pull requests

Describe:

- What changed.
- How you tested it.
- Any account-safety implications.
- Whether the change affects live mode, scheduling, targeting, or local privacy.
