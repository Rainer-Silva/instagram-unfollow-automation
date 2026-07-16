const { loadConfig } = require('./lib/config');
const { createBrowser } = require('./lib/browser');
const { createLogger } = require('./lib/logger');
const { waitForManualLogin } = require('./lib/login-session');

async function main() {
  const config = await loadConfig(process.argv.slice(2));
  const logger = createLogger(config);
  const browser = await createBrowser(config, logger);
  console.log('Log into Instagram in the visible Chrome window. Waiting up to 10 minutes...');
  const result = await waitForManualLogin({ browser, config, logger });
  if (result.loggedIn) {
    console.log(`Instagram login detected${result.username ? ` for ${result.username}` : ''}. Session saved in the local automation profile.`);
    await browser.close();
    return;
  }

  await browser.close();
  throw new Error('Timed out waiting for Instagram login.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
