const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseInteger(value, defaultValue) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--live') options.dryRun = false;
    else if (arg === '--debug') options.debug = true;
    else if (arg.startsWith('--max-unfollows=')) options.dailyMaxUnfollows = parseInteger(arg.split('=')[1], undefined);
    else if (arg.startsWith('--following-url=')) options.followingUrl = arg.split('=').slice(1).join('=');
  }
  return options;
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function loadConfig(argv) {
  dotenv.config();
  const cli = parseArgs(argv);

  const rootDir = process.cwd();
  const config = {
    rootDir,
    instagramUsername: process.env.INSTAGRAM_USERNAME || '',
    browserMode: process.env.BROWSER_MODE || 'cdp',
    chromeUserDataDir: process.env.CHROME_USER_DATA_DIR || path.join(rootDir, 'work/chrome-profile'),
    chromeProfileDir: process.env.CHROME_PROFILE_DIR || 'Default',
    chromeRemoteDebuggingUrl: process.env.CHROME_REMOTE_DEBUGGING_URL || '',
    dailyMaxUnfollows: cli.dailyMaxUnfollows ?? parseInteger(process.env.DAILY_MAX_UNFOLLOWS, 10),
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
    dryRun: cli.dryRun ?? parseBoolean(process.env.DRY_RUN, false),
    skipPersonalAccounts: parseBoolean(process.env.SKIP_PERSONAL_ACCOUNTS, true),
    preferRecentFollows: parseBoolean(process.env.PREFER_RECENT_FOLLOWS, true),
    startUrl: process.env.START_URL || 'https://www.instagram.com',
    followingUrl: cli.followingUrl || process.env.FOLLOWING_URL || '',
    scrollPauseMinSeconds: parseInteger(process.env.SCROLL_PAUSE_MIN_SECONDS, 2),
    scrollPauseMaxSeconds: parseInteger(process.env.SCROLL_PAUSE_MAX_SECONDS, 5)
  };

  for (const dir of [config.logDir, config.screenshotDir, config.reportDir, path.dirname(config.statePath)]) {
    await ensureDir(dir);
  }

  if (config.minDelaySeconds > config.maxDelaySeconds) {
    throw new Error('MIN_DELAY_SECONDS must be less than or equal to MAX_DELAY_SECONDS');
  }
  if (config.batchCooldownMinutesMin > config.batchCooldownMinutesMax) {
    throw new Error('BATCH_COOLDOWN_MINUTES must be less than or equal to BATCH_COOLDOWN_MAX_MINUTES');
  }

  return config;
}

module.exports = { loadConfig };
