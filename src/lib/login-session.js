const { updateEnvFile } = require('./env-file');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLoggedInText(text) {
  const loggedOut = /(^|\n)\s*log in\s*(\n|$)/i.test(text)
    && /(^|\n)\s*sign up\s*(\n|$)/i.test(text);
  const loggedInNav = /(^|\n)\s*(home|messages|notifications|professional dashboard|search|reels)\s*(\n|$)/i.test(text);
  return loggedInNav && !loggedOut;
}

async function detectLoggedInUsername(page) {
  const hrefs = await page.locator('a[href^="/"]').evaluateAll((links) => (
    links
      .map((link) => link.getAttribute('href') || '')
      .filter(Boolean)
  )).catch(() => []);

  const ignored = new Set([
    '',
    'accounts',
    'direct',
    'explore',
    'p',
    'reels',
    'stories',
    'about',
    'legal'
  ]);

  for (const href of hrefs) {
    const part = href.split('/').filter(Boolean)[0] || '';
    if (!part || ignored.has(part) || part.includes('.')) continue;
    return part.toLowerCase();
  }
  return '';
}

async function waitForManualLogin({ browser, config, logger, timeoutMs = 10 * 60 * 1000 }) {
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
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    if (isLoggedInText(bodyText)) {
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1500).catch(() => {});
      const username = await detectLoggedInUsername(page);
      logger.info('login_detected', { url: page.url(), username });
      return { loggedIn: true, username };
    }
    await sleep(5000);
  }
  return { loggedIn: false, username: '' };
}

async function saveDetectedLoginTarget({ envPath, username }) {
  if (!username) return false;
  await updateEnvFile(envPath, {
    INSTAGRAM_USERNAME: username,
    FOLLOWING_URL: ''
  });
  return true;
}

module.exports = {
  isLoggedInText,
  detectLoggedInUsername,
  waitForManualLogin,
  saveDetectedLoginTarget
};
