const path = require('path');
const {
  sleep,
  randomInt,
  delaySeconds,
  normalizeUsername,
  loadAllowlist,
  checkSafetyStop,
  openFollowingList,
  clickUnfollowFromCard,
  humanScroll
} = require('./instagram');
const { categorizeCandidate, sortCandidatesByCategory } = require('./categorize');
const { saveState } = require('./state');

async function saveErrorScreenshot(browser, config, label) {
  const file = path.join(
    config.screenshotDir,
    `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}.png`
  );
  await browser.page.screenshot({ path: file, fullPage: true }).catch(() => {});
  return file;
}

async function getFollowingCards(page) {
  const dialog = page.locator('[role="dialog"]').first();
  const dialogCount = await dialog.count().catch(() => 0);
  const scope = dialogCount ? dialog : page.locator('body');
  const followingButtons = scope.getByRole('button', { name: /^Following$/i });
  const buttonTotal = await followingButtons.count().catch(() => 0);
  if (buttonTotal > 0) {
    return { scope, inDialog: Boolean(dialogCount), mode: 'buttons', buttons: followingButtons, total: buttonTotal };
  }
  const rows = scope.locator('li, div').filter({ has: page.locator('a[href*="instagram.com/"], a[href^="/"]') });
  const total = await rows.count().catch(() => 0);
  return { scope, inDialog: Boolean(dialogCount), mode: 'rows', rows, total };
}

async function describeButtonCandidate(button) {
  const details = await button.evaluate((el) => {
    let node = el;
    for (let depth = 0; depth < 10 && node; depth += 1) {
      const link = node.querySelector?.('a[href*="instagram.com/"], a[href^="/"]');
      const href = link?.getAttribute?.('href') || '';
      const raw = (href || '').split('/').filter(Boolean)[0] || (link?.textContent || '');
      if (raw) {
        return {
          username: raw,
          rowText: node.innerText || node.textContent || ''
        };
      }
      node = node.parentElement;
    }
    return { username: '', rowText: '' };
  }).catch(() => ({ username: '', rowText: '' }));
  return {
    username: normalizeUsername(details.username),
    rowText: String(details.rowText || '').replace(/\s+/g, ' ').trim()
  };
}

async function scanVisibleCandidates(page, config, logger, state, allowlist, sessionSeenUsernames) {
  const snapshot = await getFollowingCards(page);
  const candidates = [];
  logger.debug('scan_scope', { total: snapshot.total, inDialog: snapshot.inDialog, mode: snapshot.mode });

  if (snapshot.mode === 'buttons') {
    for (let i = 0; i < snapshot.total; i += 1) {
      const button = snapshot.buttons.nth(i);
      const { username, rowText } = await describeButtonCandidate(button);
      if (!username || username.length < 2) continue;
      if (sessionSeenUsernames.has(username)) continue;
      sessionSeenUsernames.add(username);
      if (allowlist.has(username)) {
        logger.info('skip_allowlist', { username });
        continue;
      }
      if (state.processedUsernames[username]) {
        logger.debug('skip_resumed', { username });
        continue;
      }
      const category = categorizeCandidate({ username, rowText });
      candidates.push({ button, username, rowText, control: button, ...category });
    }
    return sortCandidatesByCategory(candidates);
  }

  for (let i = 0; i < snapshot.total; i += 1) {
    const card = snapshot.rows.nth(i);
    const link = card.locator('a[href*="instagram.com/"], a[href^="/"]').first();
    const href = await link.getAttribute('href').catch(() => '');
    const username = normalizeUsername((href || '').split('/').filter(Boolean)[0] || await link.textContent().catch(() => ''));
    const rowText = String(await card.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!username || username.length < 2) continue;
    if (sessionSeenUsernames.has(username)) {
      continue;
    }
    sessionSeenUsernames.add(username);
    if (allowlist.has(username)) {
      logger.info('skip_allowlist', { username });
      continue;
    }
    if (state.processedUsernames[username]) {
      logger.debug('skip_resumed', { username });
      continue;
    }
    const category = categorizeCandidate({ username, rowText });
    candidates.push({ card, username, rowText, control: card, ...category });
  }

  return sortCandidatesByCategory(candidates);
}

async function runUnfollowRoutine({ config, logger, state, browser }) {
  const page = browser.page;
  const allowlist = loadAllowlist(config);
  const result = {
    startedAt: new Date().toISOString(),
    completed: false,
    unfollowed: 0,
    skipped: 0,
    verifiedSkipped: 0,
    allowlistSkipped: 0,
    errors: 0
  };

  logger.info('run_started', { dryRun: config.dryRun, dailyMaxUnfollows: config.dailyMaxUnfollows });
  await page.goto(config.startUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const safety = await checkSafetyStop(page);
  if (safety) throw new Error(`Safety stop: ${safety}`);

  await openFollowingList(page, config, logger);

  let batchCount = 0;
  let loops = 0;
  const sessionSeenUsernames = new Set();

  while (state.unfollowedToday < config.dailyMaxUnfollows && loops < 1000) {
    loops += 1;
    const warning = await checkSafetyStop(page);
    if (warning) throw new Error(`Safety stop: ${warning}`);

    const candidates = await scanVisibleCandidates(page, config, logger, state, allowlist, sessionSeenUsernames);
    if (!candidates.length) {
      logger.debug('no_candidates_visible', { loops });
      await humanScroll(page, config, logger);
      continue;
    }

    for (const candidate of candidates) {
      if (state.unfollowedToday >= config.dailyMaxUnfollows) break;
      const currentWarning = await checkSafetyStop(page);
      if (currentWarning) throw new Error(`Safety stop: ${currentWarning}`);

      const candidateScope = candidate.card || candidate.control || candidate.button;
      const isVer = await candidateScope.locator('svg[aria-label*="Verified"], span[aria-label*="Verified"], [aria-label*="Verified"]').first().count().catch(() => 0);
      if (isVer) {
        state.processedUsernames[candidate.username] = { status: 'skipped_verified', at: new Date().toISOString() };
        result.verifiedSkipped += 1;
        result.skipped += 1;
        logger.info('skip_verified', { username: candidate.username });
        continue;
      }

      if (config.skipPersonalAccounts && candidate.category === 'person_or_uncategorized') {
        state.processedUsernames[candidate.username] = {
          status: 'skipped_personal_uncategorized',
          at: new Date().toISOString()
        };
        result.skipped += 1;
        logger.warn('skip_personal_uncategorized', {
          username: candidate.username,
          reason: candidate.category,
          details: 'SKIP_PERSONAL_ACCOUNTS=1'
        });
        if (!config.dryRun) {
          await saveState(config, state);
        }
        continue;
      }

      if (config.dryRun) {
        result.skipped += 1;
        logger.info('dry_run_candidate', {
          username: candidate.username,
          action: 'would_unfollow',
          reason: candidate.category,
          details: candidate.reason
        });
      } else {
        logger.info('candidate_selected', {
          username: candidate.username,
          reason: candidate.category,
          details: candidate.reason
        });
        const actionResult = await clickUnfollowFromCard(page, candidate, config, logger);
        if (actionResult.confirmed) {
          state.unfollowedToday += 1;
          batchCount += 1;
          result.unfollowed += 1;
          state.processedUsernames[candidate.username] = { status: 'unfollowed', at: new Date().toISOString() };
          logger.info('unfollow_complete', { username: candidate.username, dailyCount: state.unfollowedToday });
        } else {
          state.processedUsernames[candidate.username] = { status: 'skipped_no_button', at: new Date().toISOString() };
          result.skipped += 1;
          logger.warn('skip_no_following_button', { username: candidate.username });
        }
      }

      if (!config.dryRun) {
        state.lastSeenUsername = candidate.username;
        await saveState(config, state);
      }

      await sleep(config.dryRun ? 1000 : delaySeconds(config.minDelaySeconds, config.maxDelaySeconds));

      if (!config.dryRun && batchCount >= config.batchSize) {
        const cooldownMinutes = randomInt(config.batchCooldownMinutesMin, config.batchCooldownMinutesMax);
        logger.warn('batch_cooldown', { batchSize: batchCount, cooldownMinutes });
        await sleep(cooldownMinutes * 60 * 1000);
        batchCount = 0;
      }
    }
  }

  result.completed = true;
  result.finishedAt = new Date().toISOString();
  if (!config.dryRun) {
    await saveState(config, state);
  }
  logger.info('run_finished', {
    unfollowed: result.unfollowed,
    skipped: result.skipped,
    dryRun: config.dryRun
  });
  return result;
}

module.exports = { runUnfollowRoutine, saveErrorScreenshot };
