# Setup Instructions

1. Install Node.js dependencies:

   ```bash
   npm install
   npx playwright install chrome
   ```

2. Copy `.env.example` to `.env` and set your values.

3. Set `INSTAGRAM_USERNAME` or `FOLLOWING_URL`.

4. Set `CHROME_USER_DATA_DIR` to the dedicated automation profile directory:

   ```bash
   /Users/yourname/Library/Application Support/Google/Chrome
   ```

5. Set `CHROME_PROFILE_DIR` to the profile you actually use in Chrome, then start the dedicated automation Chrome:

   ```bash
   npm run chrome:start
   ```

6. Set `CHROME_REMOTE_DEBUGGING_URL=http://127.0.0.1:9222` in `.env` and log in manually once in that profile.

7. Add usernames you never want to unfollow to `config/allowlist.txt`.

8. Start with dry-run mode:

   ```bash
   npm run dry-run
   ```

9. If the dry-run looks correct, run the real automation:

   ```bash
   npm start
   ```

10. Review logs in `logs/`, screenshots in `screenshots/`, and the daily report in `reports/`.
