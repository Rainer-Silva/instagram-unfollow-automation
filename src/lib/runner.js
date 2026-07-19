const path = require('path');
const {
  sleep,
  randomInt,
  delaySeconds,
  normalizeUsername,
  loadAllowlist,
  checkSafetyStop,
  checkHomeFeedHealth,
  openFollowingList,
  clickUnfollowFromCard,
  clickNextVisibleFollowingButton,
  humanScroll
} = require('./instagram');
const { categorizeCandidate, sortCandidatesByCategory } = require('./categorize');
const { saveState } = require('./state');
const { publicUsername, usernameKey } = require('./privacy');

const RESERVED_PATHS = new Set([
  'about',
  'accounts',
  'archive',
  'direct',
  'explore',
  'home',
  'homehome',
  'legal',
  'popular',
  'reels',
  'stories',
  'web'
]);

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
  if (!dialogCount) {
    return { scope: page.locator('body'), inDialog: false, mode: 'missing_dialog', total: 0 };
  }
  const scope = dialog;
  const followingButtons = scope.getByRole('button', { name: /^Following$/i });
  const buttonTotal = await followingButtons.count().catch(() => 0);
  if (buttonTotal > 0) {
    return { scope, inDialog: Boolean(dialogCount), mode: 'buttons', buttons: followingButtons, total: buttonTotal };
  }
  const rows = scope.locator('li, div').filter({ has: page.locator('a[href*="instagram.com/"], a[href^="/"]') });
  const total = await rows.count().catch(() => 0);
  return { scope, inDialog: Boolean(dialogCount), mode: 'rows', rows, total };
}

function isLikelyInstagramUsername(username) {
  if (!username || username.length < 2 || username.length > 30) return false;
  if (RESERVED_PATHS.has(username)) return false;
  return /^[a-z0-9._]+$/.test(username);
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
      if (!isLikelyInstagramUsername(username) && !config.simpleCountMode) {
        logger.debug('skip_invalid_username', { username });
        continue;
      }
      const key = isLikelyInstagramUsername(username)
        ? usernameKey(config, username)
        : `visible-button-${loops}-${i}`;
      if (sessionSeenUsernames.has(key)) continue;
      sessionSeenUsernames.add(key);
      if (config.respectAllowlist && isLikelyInstagramUsername(username) && allowlist.has(username)) {
        logger.info('skip_allowlist', { username });
        continue;
      }
      if (isLikelyInstagramUsername(username) && state.processedUsernames[key]) {
        logger.debug('skip_resumed', { username });
        continue;
      }
      const category = config.simpleCountMode
        ? {
            category: 'simple_count_mode',
            reason: 'next visible Following button',
            priority: 0
          }
        : categorizeCandidate({ username, rowText });
      candidates.push({
        button,
        username: isLikelyInstagramUsername(username) ? username : `visible-${i + 1}`,
        key,
        rowText,
        control: button,
        ...category
      });
    }
    return sortCandidatesByCategory(candidates);
  }

  for (let i = 0; i < snapshot.total; i += 1) {
    const card = snapshot.rows.nth(i);
    const link = card.locator('a[href*="instagram.com/"], a[href^="/"]').first();
    const href = await link.getAttribute('href').catch(() => '');
    const username = normalizeUsername((href || '').split('/').filter(Boolean)[0] || await link.textContent().catch(() => ''));
    const rowText = String(await card.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (!isLikelyInstagramUsername(username) && !config.simpleCountMode) {
      logger.debug('skip_invalid_username', { username });
      continue;
    }
    const key = isLikelyInstagramUsername(username)
      ? usernameKey(config, username)
      : `visible-row-${loops}-${i}`;
    if (sessionSeenUsernames.has(key)) {
      continue;
    }
    sessionSeenUsernames.add(key);
    if (config.respectAllowlist && isLikelyInstagramUsername(username) && allowlist.has(username)) {
      logger.info('skip_allowlist', { username });
      continue;
    }
    if (isLikelyInstagramUsername(username) && state.processedUsernames[key]) {
      logger.debug('skip_resumed', { username });
      continue;
    }
    const category = config.simpleCountMode
      ? {
          category: 'simple_count_mode',
          reason: 'next visible Following row',
          priority: 0
        }
      : categorizeCandidate({ username, rowText });
    candidates.push({
      card,
      username: isLikelyInstagramUsername(username) ? username : `visible-${i + 1}`,
      key,
      rowText,
      control: card,
      ...category
    });
  }

  return sortCandidatesByCategory(candidates);
}

function isCategoryEligible(config, category) {
  if (config.cleanupMode === 'all') return true;
  return new Set(config.cleanupCategories || []).has(category);
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
  let lastVisibleTotal = 0;
  let stagnantScrolls = 0;
  let reopenCycles = 0;
  const sessionSeenUsernames = new Set();

  const runBatchCooldown = async () => {
    const health = await checkHomeFeedHealth(page, config, logger);
    if (!health.ok) {
      throw new Error(`Safety stop: ${health.reason}`);
    }

    const cooldownMinutes = randomInt(config.batchCooldownMinutesMin, config.batchCooldownMinutesMax);
    logger.warn('batch_cooldown', { batchSize: batchCount, cooldownMinutes });
    await sleep(cooldownMinutes * 60 * 1000);
    batchCount = 0;

    if (config.homeFeedHealthCheck && state.unfollowedToday < config.dailyMaxUnfollows) {
      await openFollowingList(page, config, logger);
      sessionSeenUsernames.clear();
      lastVisibleTotal = 0;
      stagnantScrolls = 0;
    }
  };

  while (state.unfollowedToday < config.dailyMaxUnfollows && loops < 1000) {
    loops += 1;
    const warning = await checkSafetyStop(page);
    if (warning) throw new Error(`Safety stop: ${warning}`);

    if (config.simpleCountMode && !config.dryRun) {
      const actionResult = await clickNextVisibleFollowingButton(page, config, logger);
      if (actionResult.confirmed) {
        state.unfollowedToday += 1;
        batchCount += 1;
        result.unfollowed += 1;
        state.processedUsernames[`simple-${Date.now()}`] = {
          status: 'unfollowed',
          at: new Date().toISOString()
        };
        state.lastSeenUsername = '[simple-count-mode]';
        logger.info('unfollow_complete', {
          username: '[simple-count-mode]',
          dailyCount: state.unfollowedToday
        });
        await saveState(config, state);
        await sleep(delaySeconds(config.minDelaySeconds, config.maxDelaySeconds));

        if (batchCount >= config.batchSize) {
          await runBatchCooldown();
        }
        continue;
      }
      logger.debug('simple_no_visible_following_button', { loops });
    }

    const candidates = await scanVisibleCandidates(page, config, logger, state, allowlist, sessionSeenUsernames);
    if (!candidates.length) {
      logger.debug('no_candidates_visible', { loops });
      const snapshot = await getFollowingCards(page);
      if (snapshot.mode === 'missing_dialog') {
        logger.warn('following_dialog_missing_reopen', { loops });
        await openFollowingList(page, config, logger);
        lastVisibleTotal = 0;
        stagnantScrolls = 0;
        continue;
      }
      if (snapshot.total > lastVisibleTotal) {
        lastVisibleTotal = snapshot.total;
        stagnantScrolls = 0;
      } else {
        stagnantScrolls += 1;
      }
      if (stagnantScrolls >= 12) {
        if (reopenCycles < 8 && state.unfollowedToday < config.dailyMaxUnfollows) {
          reopenCycles += 1;
          logger.warn('reopen_after_stagnant_rows', {
            visibleTotal: snapshot.total,
            stagnantScrolls,
            reopenCycles
          });
          await openFollowingList(page, config, logger);
          sessionSeenUsernames.clear();
          lastVisibleTotal = 0;
          stagnantScrolls = 0;
          continue;
        }
        logger.warn('stopping_no_new_rows', {
          visibleTotal: snapshot.total,
          stagnantScrolls
        });
        break;
      }
      await humanScroll(page, config, logger);
      continue;
    }
    stagnantScrolls = 0;
    reopenCycles = 0;

    for (const candidate of candidates) {
      if (state.unfollowedToday >= config.dailyMaxUnfollows) break;
      const currentWarning = await checkSafetyStop(page);
      if (currentWarning) throw new Error(`Safety stop: ${currentWarning}`);

      const candidateScope = candidate.card || candidate.control || candidate.button;
      const isVer = config.skipVerified
        ? await candidateScope.locator('svg[aria-label*="Verified"], span[aria-label*="Verified"], [aria-label*="Verified"]').first().count().catch(() => 0)
        : 0;
      if (config.skipVerified && isVer) {
        if (config.storeSkippedUsernames) {
          state.processedUsernames[candidate.key] = { status: 'skipped_verified', at: new Date().toISOString() };
        }
        result.verifiedSkipped += 1;
        result.skipped += 1;
        logger.info('skip_verified', { username: candidate.username });
        continue;
      }

      if (
        config.skipPersonalAccounts
        && candidate.category === 'person_or_uncategorized'
        && !isCategoryEligible(config, candidate.category)
      ) {
        if (config.storeSkippedUsernames) {
          state.processedUsernames[candidate.key] = {
            status: 'skipped_personal_uncategorized',
            at: new Date().toISOString()
          };
        }
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

      if (!isCategoryEligible(config, candidate.category)) {
        if (config.storeSkippedUsernames) {
          state.processedUsernames[candidate.key] = {
            status: 'skipped_category_not_selected',
            category: candidate.category,
            at: new Date().toISOString()
          };
        }
        result.skipped += 1;
        logger.warn('skip_category_not_selected', {
          username: candidate.username,
          reason: candidate.category,
          details: `CLEANUP_MODE=${config.cleanupMode}`
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
          state.processedUsernames[candidate.key] = { status: 'unfollowed', at: new Date().toISOString() };
          logger.info('unfollow_complete', { username: candidate.username, dailyCount: state.unfollowedToday });
        } else {
          if (config.storeSkippedUsernames) {
            state.processedUsernames[candidate.key] = { status: 'skipped_no_button', at: new Date().toISOString() };
          }
          result.skipped += 1;
          logger.warn('skip_no_following_button', { username: candidate.username });
        }
      }

      if (!config.dryRun) {
        state.lastSeenUsername = publicUsername(config, candidate.username);
        await saveState(config, state);
      }

      await sleep(config.dryRun ? 1000 : delaySeconds(config.minDelaySeconds, config.maxDelaySeconds));

      if (!config.dryRun && batchCount >= config.batchSize) {
        await runBatchCooldown();
      }

      // Instagram virtualizes/re-renders the following dialog after each action.
      // Re-scan immediately so we do not keep stale locators from the previous DOM.
      if (!config.dryRun) break;
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

module.exports = {
  runUnfollowRoutine,
  saveErrorScreenshot,
  getFollowingCards,
  isLikelyInstagramUsername,
  isCategoryEligible
};
