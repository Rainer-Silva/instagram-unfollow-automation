const fs = require('fs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delaySeconds(min, max) {
  return randomInt(min, max) * 1000;
}

function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

async function humanScroll(page, config, logger) {
  const distance = randomInt(250, 850);
  const scrolledDialog = await page.locator('[role="dialog"]').first().evaluate((dialog, amount) => {
    const candidates = [dialog, ...dialog.querySelectorAll('div')];
    const scrollable = candidates.find((el) => el.scrollHeight > el.clientHeight + 20);
    if (!scrollable) return false;
    scrollable.scrollBy({ top: amount, behavior: 'smooth' });
    return true;
  }, distance).catch(() => false);
  if (!scrolledDialog) {
    await page.mouse.wheel(0, distance);
  }
  logger.debug('scroll', { distance, target: scrolledDialog ? 'dialog' : 'page' });
  await sleep(delaySeconds(config.scrollPauseMinSeconds, config.scrollPauseMaxSeconds));
}

function loadAllowlist(config) {
  try {
    const raw = fs.readFileSync(config.allowlistPath, 'utf8');
    return new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map(normalizeUsername)
    );
  } catch {
    return new Set();
  }
}

function detectWarningText(text) {
  const haystack = String(text || '').toLowerCase();
  const patterns = [
    'action blocked',
    'try again later',
    'suspicious login',
    'we restrict certain activity',
    'feedback required',
    'your account has been temporarily blocked',
    'temporarily blocked',
    'confirm it\'s you',
    'confirm your account',
    'help us confirm',
    'verify your account',
    'enter the code',
    'security code',
    'checkpoint required'
  ];
  const warning = patterns.find((pattern) => haystack.includes(pattern));
  if (warning) return warning;

  const challengeWarningPatterns = [
    /\bchallenge required\b/,
    /\bsecurity challenge\b/,
    /\bcomplete (?:a|the) challenge\b/,
    /\bchallenge\b.{0,80}\b(account|security|verify|verification|login|code)\b/,
    /\b(account|security|verify|verification|login|code)\b.{0,80}\bchallenge\b/
  ];
  return challengeWarningPatterns.some((pattern) => pattern.test(haystack)) ? 'challenge' : '';
}

async function checkSafetyStop(page) {
  const url = page.url().toLowerCase();
  if (url.includes('/challenge/') || (url.includes('/accounts/login') && url.includes('challenge'))) {
    return 'challenge page detected';
  }
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  return detectWarningText(bodyText);
}

async function dismissCookieDialog(page, logger) {
  const buttons = [
    page.getByRole('button', { name: /Decline optional cookies/i }).first(),
    page.getByRole('button', { name: /Allow all cookies/i }).first()
  ];
  for (const button of buttons) {
    if (await button.count().catch(() => 0)) {
      logger?.info('cookie_dialog_dismissed', {});
      await button.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      return true;
    }
  }
  return false;
}

async function assertLoggedIn(page) {
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const hasLoggedOutPrompt = /(^|\n)\s*log in\s*(\n|$)/i.test(bodyText)
    && /(^|\n)\s*sign up\s*(\n|$)/i.test(bodyText);
  const hasLoggedInNav = /(^|\n)\s*(home|messages|notifications|professional dashboard)\s*(\n|$)/i.test(bodyText);
  if (hasLoggedOutPrompt && !hasLoggedInNav) {
    throw new Error('Connected Chrome profile is not logged into Instagram. Log into Instagram in the visible Chrome window launched by npm run login, then rerun a dry run.');
  }
}

async function preferRecentFollowingSort(page, config, logger) {
  if (!config.preferRecentFollows) return false;
  const dialog = page.getByRole('dialog').first();
  if (!(await dialog.count().catch(() => 0))) return false;

  const sortTriggers = [
    dialog.getByRole('button', { name: /sort|default|date followed|earliest|latest/i }).first(),
    dialog.getByText(/sort by|date followed|default/i).first()
  ];

  for (const trigger of sortTriggers) {
    if (!(await trigger.count().catch(() => 0))) continue;
    try {
      await trigger.click({ timeout: 3000 });
      await page.waitForTimeout(1000);
      const latestOption = page.getByRole('button', { name: /latest|newest|date followed:\s*latest/i }).first();
      if (await latestOption.count().catch(() => 0)) {
        await latestOption.click({ timeout: 3000 });
        await page.waitForTimeout(1500);
        logger.info('following_sort_recent_first', {});
        return true;
      }
    } catch (error) {
      logger.debug('following_sort_recent_first_retry', { message: error.message });
    }
  }

  logger.debug('following_sort_recent_first_unavailable', {});
  return false;
}

async function waitForFollowingDialog(page, logger) {
  const dialog = page.getByRole('dialog').first();
  if (await dialog.count().catch(() => 0)) {
    await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const dialogText = await dialog.innerText().catch(() => '');
    if (/sign up and never miss a post|log in/i.test(dialogText)) {
      throw new Error('Connected Chrome profile is not logged into Instagram. Start Chrome with the logged-in profile.');
    }
    logger.info('following_dialog_opened', {});
    return true;
  }
  return false;
}

async function clickFollowingCounterByDom(page, logger) {
  const box = await page.evaluate(() => {
    const matchesFollowing = (text) => /\bfollowing\b/i.test(String(text || ''));
    const isExactFollowingStat = (text) => /^[\s\d,.\u00a0]+following\s*$/i.test(String(text || '').trim());
    const elements = [...document.querySelectorAll('main a, main button, main span, main div, main li, a, button, span, div, li')];
    const candidates = elements
      .map((element) => {
        const text = element.innerText || element.textContent || '';
        const href = element.getAttribute?.('href') || '';
        const rect = element.getBoundingClientRect();
        const score = Number(/following/i.test(href)) * 10
          + Number(isExactFollowingStat(text)) * 30
          + Number(matchesFollowing(text)) * 5
          + Number(/\d/.test(text)) * 2
          + Number(rect.top >= 0 && rect.top < 360) * 3;
        return { element, text, href, score, area: rect.width * rect.height };
      })
      .filter((candidate) => candidate.score > 0 && (matchesFollowing(candidate.text) || /following/i.test(candidate.href)))
      .sort((a, b) => b.score - a.score || a.area - b.area);

    for (const candidate of candidates) {
      let element = candidate.element;
      for (let depth = 0; depth < 4 && element; depth += 1) {
        const tag = element.tagName?.toLowerCase();
        const href = element.getAttribute?.('href') || '';
        const rect = element.getBoundingClientRect();
        const text = element.innerText || element.textContent || '';
        const visible = rect.width > 5 && rect.height > 5;
        const inProfileHeaderArea = rect.top >= 0 && rect.top < 380;
        if (visible && inProfileHeaderArea && (tag === 'a' || tag === 'button' || /following/i.test(href) || isExactFollowingStat(text))) {
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            text: String(text || candidate.text).trim().replace(/\s+/g, ' ').slice(0, 120),
            href
          };
        }
        element = element.parentElement;
      }
    }
    return null;
  }).catch(() => null);

  if (!box) return false;
  logger.info('open_following_dom_fallback', { text: box.text, href: box.href });
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(2500);
  return true;
}

async function tryOpenFollowingDialog(page, config, logger) {
  const followingText = page.locator('main').getByText(/[\d,.]+\s+following/i).first();
  if (await followingText.count().catch(() => 0)) {
    try {
      logger.info('open_following_text_counter', {});
      await followingText.click({ timeout: 5000, force: true });
      await page.waitForTimeout(2500);
      if (await waitForFollowingDialog(page, logger)) return true;
    } catch (error) {
      logger.debug('open_following_text_counter_retry', { message: error.message });
    }
  }

  const followingSelectors = [
    page.locator('header').getByRole('link', { name: /following/i }).first(),
    page.locator('header').getByRole('button', { name: /following/i }).first(),
    page.locator('main').getByRole('link', { name: /following/i }).first(),
    page.locator('main').getByRole('button', { name: /following/i }).first(),
    page.locator('main').locator('a,button').filter({ hasText: /following/i }).first(),
    page.locator('a[href$="/following/"]').first()
  ];

  for (const target of followingSelectors) {
    try {
      if (await target.count().catch(() => 0)) {
        logger.info('open_following_list', {});
        await target.click({ timeout: 5000, force: true });
        await page.waitForTimeout(2500);
        if (await waitForFollowingDialog(page, logger)) return true;
      }
    } catch (error) {
      logger.debug('open_following_list_retry', { message: error.message });
    }
  }

  if (await clickFollowingCounterByDom(page, logger)) {
    const warning = await checkSafetyStop(page);
    if (warning) throw new Error(`Safety stop: ${warning}`);
    if (await waitForFollowingDialog(page, logger)) return true;
  }

  return false;
}

async function openFollowingList(page, config, logger) {
  if (!config.instagramUsername && !config.followingUrl) {
    throw new Error('Set INSTAGRAM_USERNAME or FOLLOWING_URL in .env');
  }

  const profileTarget = config.followingUrl || `https://www.instagram.com/${config.instagramUsername}/`;
  logger.info('navigate_profile', { target: profileTarget });
  await page.goto(profileTarget, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(async (error) => {
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const profileLooksLoaded = new RegExp(`\\b${config.instagramUsername}\\b`, 'i').test(bodyText)
      || /edit profile|view archive|\bfollowing\b/i.test(bodyText);
    if (!profileLooksLoaded) throw error;
    logger.warn('profile_navigation_timeout_continuing', { message: error.message });
  });
  await page.waitForTimeout(2500);
  await dismissCookieDialog(page, logger);
  await assertLoggedIn(page);
  await page.waitForFunction(() => /\bfollowing\b/i.test(document.body?.innerText || ''), null, { timeout: 15000 }).catch(() => {});

  const profileWarning = await checkSafetyStop(page);
  if (profileWarning) throw new Error(`Safety stop: ${profileWarning}`);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (await tryOpenFollowingDialog(page, config, logger)) {
      await preferRecentFollowingSort(page, config, logger);
      return;
    }
    logger.debug('open_following_attempt_retry', { attempt });
    await page.waitForTimeout(1500);
  }

  const directFollowingUrl = `${profileTarget.replace(/\/$/, '')}/following/`;
  logger.info('open_following_direct_url', { target: directFollowingUrl });
  await page.goto(directFollowingUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(async (error) => {
    logger.warn('following_direct_url_timeout', { message: error.message });
  });
  await page.waitForTimeout(3500);
  const directWarning = await checkSafetyStop(page);
  if (directWarning) throw new Error(`Safety stop: ${directWarning}`);
  if (await tryOpenFollowingDialog(page, config, logger)) {
    await preferRecentFollowingSort(page, config, logger);
    return;
  }

  throw new Error('Could not locate the Following control on the profile page');
}

async function clickUnfollowFromCard(page, candidate, config, logger) {
  const control = candidate.control || candidate.card || candidate.button;
  const role = await control.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  const clickButton = async (button) => {
    if (config.dryRun) return { action: 'dry_run_unfollow', confirmed: false };
    await button.click({ timeout: 5000 });
    await page.waitForTimeout(1000);
    const dialogButton = page.getByRole('dialog').getByRole('button', { name: /unfollow/i }).first();
    if (await dialogButton.count().catch(() => 0)) {
      await dialogButton.click({ timeout: 5000 });
    } else {
      await page.getByRole('button', { name: /^unfollow$/i }).first().click({ timeout: 5000 });
    }
    logger.info('unfollow_clicked', {});
    return { action: 'unfollowed', confirmed: true };
  };

  if (role === 'button') {
    const label = await control.innerText().catch(() => '');
    if (/following/i.test(label)) return clickButton(control);
    return { action: 'no_following_button', confirmed: false };
  }

  const buttons = control.getByRole ? control.getByRole('button') : page.getByRole('button');
  const count = await buttons.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const label = await button.innerText().catch(() => '');
    if (/following/i.test(label)) return clickButton(button);
  }
  return { action: 'no_following_button', confirmed: false };
}

module.exports = {
  sleep,
  randomInt,
  delaySeconds,
  normalizeUsername,
  humanScroll,
  loadAllowlist,
  detectWarningText,
  checkSafetyStop,
  openFollowingList,
  clickUnfollowFromCard,
  dismissCookieDialog,
  assertLoggedIn,
  preferRecentFollowingSort
};
