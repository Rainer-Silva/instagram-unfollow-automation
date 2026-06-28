const { loadConfig } = require('./lib/config');
const { createBrowser } = require('./lib/browser');
const { createLogger } = require('./lib/logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoggedInText(text) {
  const loggedOut = /(^|\n)\s*log in\s*(\n|$)/i.test(text)
    && /(^|\n)\s*sign up\s*(\n|$)/i.test(text);
  const loggedInNav = /(^|\n)\s*(home|messages|notifications|professional dashboard|search|reels)\s*(\n|$)/i.test(text);
  return loggedInNav && !loggedOut;
}

async function main() {
  const config = await loadConfig(process.argv.slice(2));
  const logger = createLogger(config);
  const browser = await createBrowser(config, logger);
  const page = browser.page;

  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded' });
  await page.bringToFront().catch(() => {});
  if (config.instagramUsername) {
    const usernameInput = page.locator('input[name="username"]').first();
    const passwordInput = page.locator('input[name="password"]').first();
    if (await usernameInput.count().catch(() => 0)) {
      await usernameInput.fill(config.instagramUsername).catch(() => {});
      await passwordInput.focus().catch(() => {});
    }
  }
  logger.info('login_window_opened', { url: page.url() });
  console.log('Log into Instagram in the visible Chrome window. Waiting up to 10 minutes...');

  for (let i = 0; i < 120; i += 1) {
    const text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    if (isLoggedInText(text)) {
      logger.info('login_detected', { url: page.url() });
      console.log('Instagram login detected. Session saved in the local automation profile.');
      await browser.close();
      return;
    }
    await sleep(5000);
  }

  await browser.close();
  throw new Error('Timed out waiting for Instagram login.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
