# Chrome Profile Safety

- Use a dedicated Chrome profile for this automation.
- Log in manually once in that profile.
- Start Chrome with `npm run chrome:start` so the browser is running with remote debugging enabled.
- Keep `CHROME_USER_DATA_DIR` pointed at your real local Chrome profile on your Mac.
- Do not commit `.env` or `config/state.json`.
- Avoid syncing the automation profile across machines.
- If Playwright cannot open the profile, verify no Chrome process is holding it open.
