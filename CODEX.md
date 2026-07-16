# Codex Runbook

This repository is a local-only macOS Instagram unfollow automation project using Node.js and Playwright.

## Non-negotiable safety rules

- Do not move execution to cloud hosting, GitHub Actions, remote servers, or public runners.
- Keep the dashboard bound to `127.0.0.1`.
- Do not add password storage or automated credential entry.
- Use a dedicated persistent local Chrome profile after the user logs in manually.
- Keep dry-run as the default behavior.
- Live unfollowing must require explicit confirmation.
- Stop immediately on Instagram warnings, login challenges, action blocks, restriction messages, or verification prompts.
- Do not describe delays, local execution, or visible browser use as undetectable, compliant, or risk-free.

## Requirements

- macOS
- Node.js `>=20`
- Google Chrome installed
- npm
- Local disk space for:
  - `work/chrome-automation-profile`
  - `logs/`
  - `screenshots/`
  - `reports/`

## First-time setup

```bash
npm install
npx playwright install chrome
cp .env.example .env
```

Edit `.env`:

```env
INSTAGRAM_USERNAME=your_instagram_username
BROWSER_MODE=persistent
CHROME_USER_DATA_DIR=work/chrome-automation-profile
DRY_RUN=1
DAILY_MAX_UNFOLLOWS=50
```

Add protected accounts to:

```text
config/allowlist.txt
```

## Login flow

Run:

```bash
npm run login
```

The user must log in manually in the visible Chrome window. Do not ask for, store, or type Instagram credentials.

## Safe verification

Always verify with dry-run first:

```bash
npm run dry-run
```

For a zero-action opener check:

```bash
npm run check
```

Expected successful opener log events:

```text
browser_launching_persistent
run_started
navigate_profile
following_dialog_opened
run_finished
```

## Live run

Live mode requires explicit confirmation:

```bash
npm run live -- --confirm-live --max-unfollows=50
```

Users may choose a higher cap, for example:

```bash
npm run live -- --confirm-live --max-unfollows=150
```

Higher caps increase exposure to account restrictions. The automation must still use configured waits, cooldowns, allowlist skipping, verified-account skipping, and safety stops.

## Web dashboard

Start locally:

```bash
npm run web
```

Open:

```text
http://127.0.0.1:3000
```

Do not expose this port publicly, tunnel it, or put it behind a public reverse proxy.

## Tests

Run:

```bash
npm test
```

Tests cover config parsing, live confirmation, URL validation, state isolation, safety detection, and core filtering helpers.

## Generated local files

Do not commit:

- `.env`
- `work/`
- `logs/`
- `screenshots/`
- `reports/`
- `config/state.json`

These may contain usernames, logs, screenshots, cached session data, or other sensitive information.

## Troubleshooting

If Chrome does not launch or source files become unreadable:

1. Check disk space:

   ```bash
   df -h .
   ```

2. Remove large installers/cache files outside the repo if the volume is full.
3. Make sure no previous automation process is running:

   ```bash
   ps aux | grep -E 'node src/index|chrome-automation-profile'
   ```

4. Re-run a zero-action check:

   ```bash
   npm run check
   ```

If Instagram profile opens but the following dialog does not open, inspect the latest screenshot in `screenshots/` and harden `src/lib/instagram.js` opener selectors without weakening safety stops.

## Important policy note

This project uses unofficial browser automation and is not affiliated with Instagram or Meta. Browser automation may violate Instagram rules or trigger account protections. Users are solely responsible for how they use this software.
