# Local Instagram Unfollow Automation

This project is a local-only macOS automation tool built with Node.js and Playwright.

## Important account and policy warning

This project uses unofficial browser automation and is not affiliated with, endorsed by, or approved by Instagram or Meta.

Using browser automation may violate Instagram's Terms of Use or automated-access restrictions. It may cause action blocks, login challenges, temporary restrictions, account suspension, or other account protections.

Randomized delays, low limits, visible browser usage, or local execution do not make automation undetectable, compliant, or risk-free.

Users are solely responsible for how they use this software and assume all associated risk.

## What it does

- Opens Instagram in a visible Chrome window
- Uses a dedicated persistent local Chrome profile after the user logs in manually
- Opens the following list and scans accounts
- Skips verified accounts
- Skips usernames in `config/allowlist.txt`
- Unfollows with configurable delays
- Stops at a configurable daily limit
- Writes CSV logs
- Saves screenshots on errors
- Persists resume state safely
- Generates a daily summary report
- Supports dry-run mode
- Prioritizes page/product/selling-like accounts before personal accounts
- Pushes accounts with mutual-friend/follows-you text to the end of the queue

## Local safeguards

- Runs only on your Mac
- Does not use cloud hosting
- Does not store Instagram credentials in code
- Uses a dedicated local Chrome session cache instead of asking for a password in code
- Stops immediately if Instagram shows a challenge, warning, or action-block message
- Adds randomized waits between configured actions
- Adds a longer cooldown after every 10 unfollows

## Setup

1. Install dependencies:

   ```bash
   npm install
   npx playwright install chrome
   ```

2. Copy `.env.example` to `.env` and adjust values.

3. Put usernames you never want to unfollow into `config/allowlist.txt`.

4. Log in once using the dedicated local automation Chrome profile:

   ```bash
   npm run login
   ```

   Enter your password/2FA manually in the visible browser. The session is cached locally in `work/chrome-automation-profile`.

5. Run a dry-run first:

   ```bash
   npm run dry-run
   ```

6. Run the real automation explicitly:

   ```bash
   npm run live -- --confirm-live
   ```

7. For long live runs started from Codex or another terminal you may close, prefer detached mode:

   ```bash
   npm run live:detached -- --confirm-live --max-unfollows=150
   npm run status
   ```

   Detached mode starts the cleaner under `caffeinate`, writes PID metadata to `config/detached-run.*`, and sends stdout/stderr to `logs/detached-run-*.log`. This prevents long cooldowns from being killed when the launching terminal session ends.

8. Start the local web dashboard:

   ```bash
   npm run web
   ```

   Open `http://127.0.0.1:3000`.

   The dashboard can change the Instagram username/profile being cleaned, open a manual login window, choose all follows or selected categories, edit the allowlist, launch dry-run/live runs, and adjust scheduler time/count.

   The recommended daily run cap is `100`. Users can intentionally choose a different cap in the dashboard or CLI, but higher limits increase account-risk exposure and still require explicit live confirmation.

   Changing the cleanup target resets local daily/resume state for safety, so processed usernames from one account are not reused for another account.

## Web login assistant

From the dashboard, use `Open Login Window` in the Cleanup Target card when the automation Chrome profile is not logged into the account you want to clean.

- The app opens visible Chrome at Instagram login.
- You type the Instagram password and any 2FA manually.
- The dashboard waits for the login to complete.
- If the username can be detected, `.env` is updated to that logged-in account and `FOLLOWING_URL` is cleared.
- The password is never stored, logged, typed by the script, or added to `.env`.

Use `Stop Login Wait` if you change your mind or Instagram asks for something you do not want to complete.

## Chrome profile setup

The recommended working mode is a dedicated persistent Chrome profile:

- `BROWSER_MODE=persistent`
- `CHROME_USER_DATA_DIR=work/chrome-automation-profile`

This keeps Instagram session cookies/cache local to your Mac and out of source control.

Do not store your Instagram password in `.env`, scripts, launchd, or source files.

## Local privacy and sensitive files

This project stores operational data locally. Local files may contain sensitive information, including:

- Instagram usernames
- Allowlist entries
- CSV logs
- Daily reports
- Error screenshots
- Browser session cookies and cached login data in the dedicated Chrome profile

By default, runtime logs and state redact account usernames:

```bash
REDACT_USERNAMES=1
```

With redaction enabled, CSV logs use `[redacted]` for usernames and daily resume state stores hashed keys for successful unfollows instead of raw usernames. Skipped usernames are not stored by default:

```bash
STORE_SKIPPED_USERNAMES=0
```

Do not:

- Commit `.env`
- Commit Chrome profile directories such as `work/chrome-automation-profile`
- Commit logs, screenshots, reports, or state files
- Expose port `3000` publicly
- Use public tunnels
- Put the dashboard behind a public reverse proxy
- Share screenshots or logs without reviewing their contents

The dashboard should remain bound to `127.0.0.1`.

Remote debugging mode is still available for advanced use. Set these in `.env` only if you want to attach to an already-running Chrome instance:

- `CHROME_USER_DATA_DIR`
- `CHROME_PROFILE_DIR`
- `CHROME_REMOTE_DEBUGGING_PORT`
- `CHROME_REMOTE_DEBUGGING_URL` if you want to attach to a running Chrome started with remote debugging

## Cleanup Mode

The default mode is count-driven cleanup:

```bash
CLEANUP_MODE=all
SKIP_PERSONAL_ACCOUNTS=0
```

This keeps the tool simple and focused on reaching the configured daily count. Candidates are still sorted so obvious business/product/public pages tend to be attempted first, but personal-looking accounts are no longer skipped by default.

Verified accounts and allowlisted accounts are still skipped.

## Daily scheduling

This repo includes a launchd example at `config/launchd/com.local.instagram-unfollow.plist`.

The local dashboard can update the scheduled hour, minute, and daily cap. It writes:

- `.env` for `DAILY_MAX_UNFOLLOWS` and scheduled dry-run/live mode
- `config/launchd/com.local.instagram-unfollow.plist` for the launchd run time

After changing schedule settings in the dashboard, click `Install / Reload` to copy the plist into `~/Library/LaunchAgents`.

The scheduled launchd job uses `caffeinate -dimsu npm run scheduled -- --live --confirm-live`. This keeps the Mac awake while cleanup is running and clears stale locks from the dedicated automation Chrome profile before launch.

Important sleep limits:

- A Mac cannot run browser automation while fully asleep.
- A locked Mac can run it if the user session is active and the Mac is awake.
- `Install Wake` in the dashboard calls `pmset repeat wakeorpoweron` to request a wake a few minutes before the launchd time.
- Wake scheduling is local to your Mac and may require administrator permission depending on macOS settings.
- For best reliability, keep the Mac plugged in and leave the lid open or use clamshell mode with power/display connected.

Example install flow:

```bash
launchctl unload ~/Library/LaunchAgents/com.local.instagram-unfollow.plist 2>/dev/null || true
cp config/launchd/com.local.instagram-unfollow.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.local.instagram-unfollow.plist
```

The plist uses `npm run scheduled -- --live --confirm-live`, so `.env` can remain `DRY_RUN=1` for manual safety while the scheduled job intentionally runs live with the configured daily cap.

Adjust paths and timing inside the plist before loading it.

## Reports and logs

- CSV logs: `logs/unfollow-actions-YYYY-MM-DD.csv`
- Error screenshots: `screenshots/`
- Resume state: `config/state.json`
- Summary reports: `reports/daily-summary-YYYY-MM-DD.md`

You can generate a summary report from today’s logs with:

```bash
npm run report
```

## Debugging

Set `DEBUG=1` in `.env` for verbose logging.

## Important warning

Instagram automation can still trigger account protections. Keep limits low, prefer dry-run testing, and stop immediately if the app detects a warning or challenge page.
