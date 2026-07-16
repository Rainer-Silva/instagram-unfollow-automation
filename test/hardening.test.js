const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseBoolean,
  parseInteger,
  validateInstagramUrl,
  validateCleanupMode,
  validateCleanupCategories,
  validateTiming,
  validateRunLimit,
  assertLiveConfirmed
} = require('../src/lib/validation');
const { loadConfig } = require('../src/lib/config');
const { normalizeUsername, detectWarningText, loadAllowlist } = require('../src/lib/instagram');
const { categorizeCandidate } = require('../src/lib/categorize');
const { loadState, saveState } = require('../src/lib/state');
const { isLikelyInstagramUsername, isCategoryEligible } = require('../src/lib/runner');

async function withTempProject(fn) {
  const previousCwd = process.cwd();
  const previousEnv = { ...process.env };
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ig-hardening-'));
  process.chdir(dir);
  for (const key of Object.keys(process.env)) {
    if (/^(DRY_RUN|DAILY_MAX_UNFOLLOWS|MIN_DELAY_SECONDS|MAX_DELAY_SECONDS|BATCH_|CLEANUP_|FOLLOWING_URL|INSTAGRAM_|CONFIRM_LIVE|ALLOWLIST_PATH|STATE_PATH|LOG_DIR|SCREENSHOT_DIR|REPORT_DIR|BROWSER_MODE|CHROME_)/.test(key)) {
      delete process.env[key];
    }
  }
  try {
    await fs.promises.mkdir('config', { recursive: true });
    return await fn(dir);
  } finally {
    process.chdir(previousCwd);
    process.env = previousEnv;
  }
}

test('boolean and integer parsing', () => {
  assert.equal(parseBoolean(undefined, true), true);
  assert.equal(parseBoolean('true'), true);
  assert.equal(parseBoolean('0'), false);
  assert.equal(parseInteger('12', 1), 12);
  assert.equal(parseInteger('12.5', 1), 1);
  assert.equal(parseInteger('nope', 7), 7);
});

test('dry-run defaults to true and live requires explicit confirmation', async () => {
  await withTempProject(async () => {
    const dry = await loadConfig([]);
    assert.equal(dry.dryRun, true);

    const live = await loadConfig(['--live']);
    assert.equal(live.dryRun, false);
    assert.throws(() => assertLiveConfirmed(live), /Live mode requires explicit confirmation/);

    const confirmed = await loadConfig(['--live', '--confirm-live']);
    assert.doesNotThrow(() => assertLiveConfirmed(confirmed));
  });
});

test('daily limit, delay, batch, cleanup validation', () => {
  assert.equal(validateRunLimit(50), 50);
  assert.equal(validateRunLimit(150), 150);
  assert.throws(() => validateRunLimit(501), /0 to 500/);
  assert.throws(() => validateTiming({
    minDelaySeconds: 4,
    maxDelaySeconds: 90,
    batchSize: 10,
    batchCooldownMinutesMin: 0,
    batchCooldownMinutesMax: 1
  }), /MIN_DELAY_SECONDS/);
  assert.throws(() => validateTiming({
    minDelaySeconds: 20,
    maxDelaySeconds: 10,
    batchSize: 10,
    batchCooldownMinutesMin: 0,
    batchCooldownMinutesMax: 1
  }), /MAX_DELAY_SECONDS/);
  assert.throws(() => validateTiming({
    minDelaySeconds: 20,
    maxDelaySeconds: 90,
    batchSize: 0,
    batchCooldownMinutesMin: 0,
    batchCooldownMinutesMax: 1
  }), /BATCH_SIZE/);
  assert.equal(validateCleanupMode('all'), 'all');
  assert.throws(() => validateCleanupMode('unsafe'), /CLEANUP_MODE/);
  assert.deepEqual(validateCleanupCategories(['public_or_general_page'], 'categories'), ['public_or_general_page']);
  assert.throws(() => validateCleanupCategories(['bad'], 'categories'), /Unknown cleanup category/);
});

test('Instagram URL validation rejects non-Instagram URLs', () => {
  assert.equal(validateInstagramUrl(''), '');
  assert.equal(validateInstagramUrl('https://www.instagram.com/name/following/'), 'https://www.instagram.com/name/following/');
  assert.throws(() => validateInstagramUrl('http://instagram.com/name'), /https/);
  assert.throws(() => validateInstagramUrl('javascript:alert(1)'), /Instagram URL|instagram.com/);
  assert.throws(() => validateInstagramUrl('https://evil.example/name'), /instagram.com/);
  assert.throws(() => validateInstagramUrl('file:///tmp/x'), /instagram.com/);
});

test('username normalization, allowlist matching, and category eligibility', async () => {
  await withTempProject(async () => {
    await fs.promises.writeFile('config/allowlist.txt', 'Friend.One\n# comment\nbrand\n', 'utf8');
    const config = { allowlistPath: path.resolve('config/allowlist.txt'), cleanupMode: 'categories', cleanupCategories: ['public_or_general_page'] };
    const allowlist = loadAllowlist(config);
    assert.equal(normalizeUsername('@Friend.One/'), 'friend.one');
    assert.equal(allowlist.has('friend.one'), true);
    assert.equal(isCategoryEligible(config, 'public_or_general_page'), true);
    assert.equal(isCategoryEligible(config, 'person_or_uncategorized'), false);
  });
});

test('candidate category and username validation', () => {
  assert.equal(categorizeCandidate({ username: 'shop_page', rowText: 'Official store' }).category, 'selling_or_product_page');
  assert.equal(categorizeCandidate({ username: 'friend', rowText: 'Followed by alex' }).category, 'mutual_friends_last');
  assert.equal(isLikelyInstagramUsername('real.user_1'), true);
  assert.equal(isLikelyInstagramUsername('accounts'), false);
  assert.equal(isLikelyInstagramUsername('https:'), false);
});

test('state isolation when cleanup target changes', async () => {
  await withTempProject(async () => {
    const configA = { statePath: path.resolve('config/state.json'), instagramUsername: 'one', followingUrl: '' };
    const stateA = await loadState(configA, { info() {} });
    stateA.unfollowedToday = 3;
    await saveState(configA, stateA);

    const configB = { statePath: configA.statePath, instagramUsername: 'two', followingUrl: '' };
    const stateB = await loadState(configB, { info() {} });
    assert.equal(stateB.unfollowedToday, 0);
    assert.equal(stateB.targetAccount, 'two');
  });
});

test('safety-stop detection catches account warnings without matching ordinary challenges', () => {
  assert.equal(detectWarningText('Join our 28-Day AI Challenge'), '');
  assert.match(detectWarningText('Action blocked. Try again later.'), /action blocked|try again later/);
  assert.match(detectWarningText('Complete the security challenge to verify your account'), /verify your account|challenge/);
  assert.match(detectWarningText('We restrict certain activity to protect our community'), /we restrict certain activity/);
});
