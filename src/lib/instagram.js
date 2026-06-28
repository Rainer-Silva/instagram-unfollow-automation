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
    'challenge',
    'suspicious login',
    'we restrict certain activity',
    'feedback required',
    'your account has been temporarily blocked',
    'temporarily blocked'
  ];
  return patterns.find((pattern) => haystack.includes(pattern));
}

async function checkSafetyStop(page) {
  const url = page.url().toLowerCase();
  if (url.includes('/challenge/') || url.includes('/accounts/login') && url.includes('challenge')) {
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
    throw new Error('Connected Chrome profile is not logged into Instagram. Log into Instagram in the visible Chrome window launched by npm run chrome:start, then rerun npm run dry-run.');
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

async function openFollowingList(page, config, logger) {
  if (!config.instagramUsername && !config.followingUrl) {
    throw new Error('Set INSTAGRAM_USERNAME or FOLLOWING_URL in .env');
  }
  const profileTarget = config.followingUrl || `https://www.instagram.com/${config.instagramUsername}/`;
  logger.info('navigate_profile', { target: profileTarget });
  await page.goto(profileTarget, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await dismissCookieDialog(page, logger);
  await assertLoggedIn(page);

  const profileWarning = await checkSafetyStop(page);
  if (profileWarning) {
    throw new Error(`Safety stop: ${profileWarning}`);
  }

  const followingSelectors = [
    page.locator('header').getByRole('link', { name: /following/i }).first(),
    page.locator('header').getByRole('button', { name: /following/i }).first(),
    page.locator('main').getByRole('link', { name: /following/i }).first(),
    page.locator('main').getByRole('button', { name: /following/i }).first(),
    page.getByText(/following/i).first(),
    page.locator('a,button').filter({ hasText: /following/i }).first(),
    page.locator('a[href$="/following/"]').first()
  ];

  for (const target of followingSelectors) {
    try {
      if (await target.count().catch(() => 0)) {
        logger.info('open_following_list', {});
        await target.click({ timeout: 5000 });
        await page.waitForTimeout(2500);
        break;
      }
    } catch (error) {
      logger.debug('open_following_list_retry', { message: error.message });
    }
  }

  const afterClickWarning = await checkSafetyStop(page);
  if (afterClickWarning) {
    throw new Error(`Safety stop: ${afterClickWarning}`);
  }
  await dismissCookieDialog(page, logger);

  const dialog = page.getByRole('dialog').first();
  if (await dialog.count().catch(() => 0)) {
    await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    const dialogText = await dialog.innerText().catch(() => '');
    if (/sign up and never miss a post|log in/i.test(dialogText)) {
      throw new Error('Connected Chrome profile is not logged into Instagram. Start Chrome with the logged-in profile.');
    }
    await preferRecentFollowingSort(page, config, logger);
    logger.info('following_dialog_opened', {});
    return;
  }

  const scrollables = [
    page.locator('main'),
    page.locator('body')
  ];
  for (const scope of scrollables) {
    const candidates = [
      scope.getByText(/^Following$/i).first(),
      scope.getByRole('link', { name: /^Following$/i }).first(),
      scope.getByRole('button', { name: /^Following$/i }).first()
    ];
    for (const candidate of candidates) {
      if (await candidate.count().catch(() => 0)) {
        logger.info('open_following_from_profile', {});
        await candidate.click({ timeout: 5000 }).catch(async () => {
          await candidate.scrollIntoViewIfNeeded().catch(() => {});
          await candidate.click({ timeout: 5000 });
        });
        await page.waitForTimeout(2500);
        return;
      }
    }
  }

  throw new Error('Could not locate the Following control on the profile page');
}

async function clickUnfollowFromCard(page, candidate, config, logger) {
  const control = candidate.control || candidate.card || candidate.button;
  const role = await control.evaluate((el) => el.tagName.toLowerCase()).catch(() => '');
  if (role === 'button') {
    const label = await control.innerText().catch(() => '');
    if (/following/i.test(label)) {
      if (config.dryRun) {
        return { action: 'dry_run_unfollow', confirmed: false };
      }
      await control.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      const unfollowDialogButton = page.getByRole('dialog').getByRole('button', { name: /unfollow/i }).first();
      if (await unfollowDialogButton.count().catch(() => 0)) {
        await unfollowDialogButton.click({ timeout: 5000 });
      } else {
        const visibleUnfollowButton = page.getByRole('button', { name: /^unfollow$/i }).first();
        await visibleUnfollowButton.click({ timeout: 5000 });
      }
      logger.info('unfollow_clicked', {});
      return { action: 'unfollowed', confirmed: true };
    }
    return { action: 'no_following_button', confirmed: false };
  }

  const buttons = control.getByRole ? control.getByRole('button') : page.getByRole('button');
  const count = await buttons.count().catch(() => 0);
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const label = await button.innerText().catch(() => '');
    if (/following/i.test(label)) {
      if (config.dryRun) {
        return { action: 'dry_run_unfollow', confirmed: false };
      }
      await button.click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      const unfollowDialogButton = page.getByRole('dialog').getByRole('button', { name: /unfollow/i }).first();
      if (await unfollowDialogButton.count().catch(() => 0)) {
        await unfollowDialogButton.click({ timeout: 5000 });
      } else {
        const visibleUnfollowButton = page.getByRole('button', { name: /^unfollow$/i }).first();
        await visibleUnfollowButton.click({ timeout: 5000 });
      }
      logger.info('unfollow_clicked', {});
      return { action: 'unfollowed', confirmed: true };
    }
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
  checkSafetyStop,
  openFollowingList,
  clickUnfollowFromCard,
  dismissCookieDialog,
  assertLoggedIn,
  preferRecentFollowingSort,
};
