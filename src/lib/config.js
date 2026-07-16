const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const {
  KNOWN_CLEANUP_CATEGORIES,
  parseBoolean,
  parseInteger,
  validateInstagramUsername,
  validateInstagramUrl,
  validateCleanupMode,
  validateCleanupCategories,
  validateTiming,
  validateRunLimit,
  assertLiveConfirmed
} = require('./validation');

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--live') options.dryRun = false;
    else if (arg === '--confirm-live') options.confirmLive = true;
    else if (arg === '--debug') options.debug = true;
    else if (arg.startsWith('--max-unfollows=')) options.dailyMaxUnfollows = parseInteger(arg.split('=')[1], undefined);
    else if (arg.startsWith('--following-url=')) options.followingUrl = arg.split('=').slice(1).join('=');
    else if (arg.startsWith('--cleanup-mode=')) options.cleanupMode = arg.split('=')[1];
    else if (arg.startsWith('--categories=')) options.cleanupCategories = arg.split('=')[1];
  }
  return options;
}

function parseList(value, defaultValue = []) {
  if (!value) return defaultValue;
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function loadConfig(argv) {
  dotenv.config({ override: true });
  const cli = parseArgs(argv);

  const rootDir = process.cwd();
  const cleanupMode = validateCleanupMode(cli.cleanupMode || process.env.CLEANUP_MODE || 'categories');
  const cleanupCategories = validateCleanupCategories(parseList(
    cli.cleanupCategories || process.env.CLEANUP_CATEGORIES,
    [
      'instagram_business_or_creator_category',
      'selling_or_product_page',
      'public_or_general_page'
    ]
  ), cleanupMode);

  const config = {
    rootDir,
    instagramUsername: validateInstagramUsername(process.env.INSTAGRAM_USERNAME || ''),
    browserMode: process.env.BROWSER_MODE || 'cdp',
    chromeUserDataDir: process.env.CHROME_USER_DATA_DIR || path.join(rootDir, 'work/chrome-profile'),
    chromeProfileDir: process.env.CHROME_PROFILE_DIR || 'Default',
    chromeRemoteDebuggingUrl: process.env.CHROME_REMOTE_DEBUGGING_URL || '',
    dailyMaxUnfollows: validateRunLimit(cli.dailyMaxUnfollows ?? parseInteger(process.env.DAILY_MAX_UNFOLLOWS, 10)),
    minDelaySeconds: parseInteger(process.env.MIN_DELAY_SECONDS, 20),
    maxDelaySeconds: parseInteger(process.env.MAX_DELAY_SECONDS, 90),
    batchSize: parseInteger(process.env.BATCH_SIZE, 10),
    batchCooldownMinutesMin: parseInteger(process.env.BATCH_COOLDOWN_MINUTES, 10),
    batchCooldownMinutesMax: parseInteger(process.env.BATCH_COOLDOWN_MAX_MINUTES, 20),
    allowlistPath: path.resolve(rootDir, process.env.ALLOWLIST_PATH || 'config/allowlist.txt'),
    statePath: path.resolve(rootDir, process.env.STATE_PATH || 'config/state.json'),
    logDir: path.resolve(rootDir, process.env.LOG_DIR || 'logs'),
    screenshotDir: path.resolve(rootDir, process.env.SCREENSHOT_DIR || 'screenshots'),
    reportDir: path.resolve(rootDir, process.env.REPORT_DIR || 'reports'),
    debug: cli.debug ?? parseBoolean(process.env.DEBUG, false),
    dryRun: cli.dryRun ?? parseBoolean(process.env.DRY_RUN, true),
    confirmLive: cli.confirmLive || parseBoolean(process.env.CONFIRM_LIVE, false),
    skipPersonalAccounts: parseBoolean(process.env.SKIP_PERSONAL_ACCOUNTS, true),
    preferRecentFollows: parseBoolean(process.env.PREFER_RECENT_FOLLOWS, true),
    cleanupMode,
    cleanupCategories,
    startUrl: process.env.START_URL || 'https://www.instagram.com',
    followingUrl: validateInstagramUrl(cli.followingUrl || process.env.FOLLOWING_URL || ''),
    scrollPauseMinSeconds: parseInteger(process.env.SCROLL_PAUSE_MIN_SECONDS, 2),
    scrollPauseMaxSeconds: parseInteger(process.env.SCROLL_PAUSE_MAX_SECONDS, 5)
  };

  for (const dir of [config.logDir, config.screenshotDir, config.reportDir, path.dirname(config.statePath)]) {
    await ensureDir(dir);
  }

  validateTiming(config);

  return config;
}

module.exports = {
  loadConfig,
  parseArgs,
  parseList,
  parseBoolean,
  parseInteger,
  KNOWN_CLEANUP_CATEGORIES
};
