# Local Instagram Unfollow Automation

This project is a local-only macOS automation tool built with Node.js and Playwright.

## What it does

- Opens Instagram in a visible Chrome window
- Reuses your existing Chrome login session/profile
- Opens the following list and scans accounts
- Skips verified accounts
- Skips usernames in `config/allowlist.txt`
- Unfollows slowly with randomized waits
- Stops at a configurable daily limit
- Writes CSV logs
- Saves screenshots on errors
- Persists resume state safely
- Generates a daily summary report
- Supports dry-run mode
- Prioritizes page/product/selling-like accounts before personal accounts
- Pushes accounts with mutual-friend/follows-you text to the end of the queue
- Can import a local Instagram data export to auto-allowlist accounts from message/interaction files

## Safety first

- Runs only on your Mac
- Does not use cloud hosting
- Does not store Instagram credentials in code
- Uses a dedicated local Chrome session cache instead of asking for a password in code
- Stops immediately if Instagram shows a challenge, warning, or action-block message
- Adds randomized waits between 20 and 90 seconds
- Adds a longer cooldown after every 10 unfollows
- Uses human-like scrolling only

## Setup

1. Install dependencies:

   ```bash
   npm install
   npx playwright install chrome
   ```

2. Copy `.env.example` to `.env` and adjust values.

3. Copy `config/allowlist.example.txt` to `config/allowlist.txt`, then add usernames you never want to unfollow.

4. Log in once using the dedicated local automation Chrome profile:

   ```bash
   npm run login
   ```

   Enter your password/2FA manually in the visible browser. The session is cached locally in `work/chrome-automation-profile`.

5. Run a dry-run first:

   ```bash
   npm run dry-run
   ```

6. Optional: import a local Instagram data export to protect people you have messaged or interacted with:

   ```bash
   npm run import-allowlist -- /path/to/instagram-export
   ```

   This reads local JSON export files only. It does not log into Instagram, scrape DMs, or store passwords.

7. Run the real automation explicitly:

   ```bash
   npm run live
   ```

8. Start the local web dashboard:

   ```bash
   npm run web
   ```

   Open `http://127.0.0.1:3000`.

   The dashboard can change the Instagram username/profile being cleaned, open a manual login window, choose all follows or selected categories, edit the allowlist, launch dry-run/live runs, and adjust scheduler time/count.

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

Remote debugging mode is still available for advanced use. Set these in `.env` only if you want to attach to an already-running Chrome instance:

- `CHROME_USER_DATA_DIR`
- `CHROME_PROFILE_DIR`
- `CHROME_REMOTE_DEBUGGING_PORT`
- `CHROME_REMOTE_DEBUGGING_URL` if you want to attach to a running Chrome started with remote debugging

## Prioritization

Candidates are grouped before action:

- `selling_or_product_page`: product, store, shop, sale, brand, course, coaching, etc.
- `instagram_business_or_creator_category`: Instagram-visible labels such as product/service, shopping/retail, local business, digital creator, public figure, artist, musician/band, restaurant, etc.
- `public_or_general_page`: media, news, travel, embassy, company, restaurant, community, etc.
- `person_or_uncategorized`: normal personal-looking accounts.
- `mutual_friends_last`: accounts with mutual-friend/follows-you style row text.

Verified accounts and allowlisted accounts are still skipped.

By default, `SKIP_PERSONAL_ACCOUNTS=1` means `person_or_uncategorized` accounts are skipped. This is safer because Instagram often does not expose enough mutual-friend context in the following-list row.

By default, `PREFER_RECENT_FOLLOWS=1` attempts to use Instagram's following-list sorting controls to start with latest/recent follows when that UI is available.

## Daily scheduling

This repo includes a launchd example at `config/launchd/com.local.instagram-unfollow.plist`.

The local dashboard can update the scheduled hour, minute, and daily cap. It writes:

- `.env` for `DAILY_MAX_UNFOLLOWS` and scheduled dry-run/live mode
- `config/launchd/com.local.instagram-unfollow.plist` for the launchd run time

After changing schedule settings in the dashboard, click `Install / Reload` to copy the plist into `~/Library/LaunchAgents`.

Example install flow:

```bash
launchctl unload ~/Library/LaunchAgents/com.local.instagram-unfollow.plist 2>/dev/null || true
cp config/launchd/com.local.instagram-unfollow.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.local.instagram-unfollow.plist
```

The plist uses `npm run live`, so `.env` can remain `DRY_RUN=1` for manual safety while the scheduled job intentionally runs live with the configured daily cap.

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

Instagram automation can still trigger account protections even when used conservatively. Keep limits low, prefer dry-run testing, and stop immediately if the app detects a warning or challenge page.
