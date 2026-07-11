const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig } = require('./lib/config');
const { loadState } = require('./lib/state');
const { createLogger } = require('./lib/logger');
const { createBrowser } = require('./lib/browser');
const { readEnvFile, updateEnvFile } = require('./lib/env-file');
const { waitForManualLogin, saveDetectedLoginTarget } = require('./lib/login-session');
const {
  readSchedule,
  writeSchedule,
  installSchedule,
  installWakeSchedule,
  clearWakeSchedule,
  setScheduleEnabled
} = require('./lib/scheduler');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const rootDir = process.cwd();
const webDir = path.join(rootDir, 'web');
const envPath = path.join(rootDir, '.env');
const cleanupCategories = [
  'instagram_business_or_creator_category',
  'selling_or_product_page',
  'public_or_general_page',
  'person_or_uncategorized',
  'mutual_friends_last'
];

let activeRun = null;
let activeLogin = null;
let lastRun = {
  running: false,
  mode: '',
  maxUnfollows: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  output: []
};
let lastLogin = {
  running: false,
  startedAt: null,
  finishedAt: null,
  loggedIn: false,
  username: '',
  error: '',
  output: []
};

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function text(res, status, payload, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': contentType });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function latestFile(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(predicate)
    .map((name) => {
      const file = path.join(dir, name);
      return { name, file, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] || null;
}

function tailFile(file, maxLines = 120) {
  if (!file || !fs.existsSync(file)) return '';
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

async function statusPayload() {
  const config = await loadConfig([]);
  const state = await loadState(config, { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
  const env = await readEnvFile(envPath);
  const report = latestFile(config.reportDir, (name) => name.endsWith('.md'));
  const log = latestFile(config.logDir, (name) => name.endsWith('.csv'));
  const allowlist = fs.existsSync(config.allowlistPath)
    ? fs.readFileSync(config.allowlistPath, 'utf8')
    : '';

  return {
    account: config.instagramUsername,
    followingUrl: config.followingUrl,
    dryRun: config.dryRun,
    dailyMaxUnfollows: config.dailyMaxUnfollows,
    cleanup: {
      mode: config.cleanupMode,
      categories: config.cleanupCategories,
      availableCategories: cleanupCategories
    },
    today: {
      date: state.date,
      unfollowed: state.unfollowedToday,
      remaining: Math.max(0, config.dailyMaxUnfollows - state.unfollowedToday),
      lastSeenUsername: state.lastSeenUsername || ''
    },
    safety: {
      minDelaySeconds: config.minDelaySeconds,
      maxDelaySeconds: config.maxDelaySeconds,
      batchSize: config.batchSize,
      cooldownMinutesMin: config.batchCooldownMinutesMin,
      cooldownMinutesMax: config.batchCooldownMinutesMax,
      skipPersonalAccounts: config.skipPersonalAccounts
    },
    scheduler: readSchedule(rootDir),
    activeRun: {
      running: Boolean(activeRun),
      mode: lastRun.mode,
      maxUnfollows: lastRun.maxUnfollows,
      startedAt: lastRun.startedAt,
      finishedAt: lastRun.finishedAt,
      exitCode: lastRun.exitCode,
      output: lastRun.output.slice(-80)
    },
    login: {
      running: Boolean(activeLogin),
      startedAt: lastLogin.startedAt,
      finishedAt: lastLogin.finishedAt,
      loggedIn: lastLogin.loggedIn,
      username: lastLogin.username,
      error: lastLogin.error,
      output: lastLogin.output.slice(-40)
    },
    files: {
      latestReport: report?.file || '',
      latestLog: log?.file || ''
    },
    reportPreview: tailFile(report?.file, 80),
    logPreview: tailFile(log?.file, 80),
    allowlist,
    env: {
      DAILY_MAX_UNFOLLOWS: env.values.DAILY_MAX_UNFOLLOWS || '',
      DRY_RUN: env.values.DRY_RUN || '',
      DEBUG: env.values.DEBUG || '',
      INSTAGRAM_USERNAME: env.values.INSTAGRAM_USERNAME || '',
      FOLLOWING_URL: env.values.FOLLOWING_URL || '',
      CLEANUP_MODE: env.values.CLEANUP_MODE || '',
      CLEANUP_CATEGORIES: env.values.CLEANUP_CATEGORIES || ''
    }
  };
}

function appendLoginOutput(line) {
  lastLogin.output.push(`[${new Date().toISOString()}] ${line}`);
  if (lastLogin.output.length > 120) lastLogin.output.shift();
}

async function startLoginFlow() {
  if (activeRun) {
    throw new Error('Stop the active run before opening the login window.');
  }
  if (activeLogin) {
    throw new Error('A login window is already active.');
  }

  lastLogin = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    loggedIn: false,
    username: '',
    error: '',
    output: []
  };
  appendLoginOutput('Opening visible Chrome login window. Enter credentials manually.');

  let browser = null;
  let logger = null;
  let config = null;
  try {
    config = await loadConfig([]);
    logger = createLogger(config);
    browser = await createBrowser(config, logger);
    activeLogin = { browser, logger };
  } catch (error) {
    lastLogin.running = false;
    lastLogin.finishedAt = new Date().toISOString();
    lastLogin.error = error.message;
    appendLoginOutput(error.message);
    if (browser) await browser.close().catch(() => {});
    if (logger) await logger.close().catch(() => {});
    throw error;
  }

  waitForManualLogin({ browser, config, logger })
    .then(async (result) => {
      lastLogin.loggedIn = result.loggedIn;
      lastLogin.username = result.username || '';
      if (result.loggedIn && result.username) {
        await saveDetectedLoginTarget({ envPath, username: result.username });
        appendLoginOutput(`Login detected as ${result.username}. Cleanup target updated.`);
      } else if (result.loggedIn) {
        appendLoginOutput('Login detected, but username could not be detected automatically.');
      } else {
        lastLogin.error = 'Timed out waiting for manual login.';
        appendLoginOutput(lastLogin.error);
      }
    })
    .catch((error) => {
      if (lastLogin.error !== 'Stopped by user.') {
        lastLogin.error = error.message;
        appendLoginOutput(error.message);
      }
    })
    .finally(async () => {
      lastLogin.running = false;
      lastLogin.finishedAt = new Date().toISOString();
      activeLogin = null;
      await browser.close().catch(() => {});
      await logger.close().catch(() => {});
    });
}

async function stopLoginFlow() {
  if (!activeLogin) return false;
  appendLoginOutput('Manual login wait stopped by user.');
  lastLogin.running = false;
  lastLogin.finishedAt = new Date().toISOString();
  lastLogin.error = 'Stopped by user.';
  const { browser, logger } = activeLogin;
  activeLogin = null;
  await browser.close().catch(() => {});
  await logger.close().catch(() => {});
  return true;
}

function startRun({ mode, maxUnfollows }) {
  if (activeRun) {
    throw new Error('A run is already active.');
  }
  const normalizedMode = mode === 'live' ? 'live' : 'dry-run';
  const normalizedMax = Number(maxUnfollows);
  if (!Number.isInteger(normalizedMax) || normalizedMax < 0 || normalizedMax > 500) {
    throw new Error('Max unfollows must be an integer from 0 to 500.');
  }

  const args = ['src/index.js', normalizedMode === 'live' ? '--live' : '--dry-run', `--max-unfollows=${normalizedMax}`];
  const child = spawn(process.execPath, args, {
    cwd: rootDir,
    env: process.env
  });

  activeRun = child;
  lastRun = {
    running: true,
    mode: normalizedMode,
    maxUnfollows: normalizedMax,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    output: []
  };

  const append = (chunk) => {
    String(chunk).split(/\r?\n/).filter(Boolean).forEach((line) => {
      lastRun.output.push(line);
      if (lastRun.output.length > 300) lastRun.output.shift();
    });
  };

  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('exit', (code) => {
    lastRun.running = false;
    lastRun.finishedAt = new Date().toISOString();
    lastRun.exitCode = code;
    activeRun = null;
  });
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/status') {
    return json(res, 200, await statusPayload());
  }

  if (req.method === 'POST' && pathname === '/api/run') {
    const body = await readJson(req);
    startRun(body);
    return json(res, 202, { ok: true, activeRun: lastRun });
  }

  if (req.method === 'POST' && pathname === '/api/stop') {
    if (activeRun) {
      activeRun.kill('SIGINT');
      return json(res, 202, { ok: true });
    }
    return json(res, 200, { ok: true, message: 'No active run.' });
  }

  if (req.method === 'POST' && pathname === '/api/login/start') {
    await startLoginFlow();
    return json(res, 202, { ok: true, login: lastLogin });
  }

  if (req.method === 'POST' && pathname === '/api/login/stop') {
    const stopped = await stopLoginFlow();
    return json(res, 200, { ok: true, stopped });
  }

  if (req.method === 'POST' && pathname === '/api/allowlist') {
    const body = await readJson(req);
    const config = await loadConfig([]);
    await fs.promises.writeFile(config.allowlistPath, String(body.allowlist || ''), 'utf8');
    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    const body = await readJson(req);
    const account = String(body.account || '').trim().replace(/^@/, '').toLowerCase();
    const followingUrl = String(body.followingUrl || '').trim();
    const cleanupMode = body.cleanupMode === 'all' ? 'all' : 'categories';
    const selectedCategories = Array.isArray(body.cleanupCategories)
      ? body.cleanupCategories.filter((category) => cleanupCategories.includes(category))
      : [];

    if (!account && !followingUrl) {
      throw new Error('Set an Instagram username or a following URL.');
    }
    if (account && !/^[a-z0-9._]{1,30}$/.test(account)) {
      throw new Error('Instagram username can only contain letters, numbers, dots, and underscores.');
    }
    if (cleanupMode === 'categories' && selectedCategories.length === 0) {
      throw new Error('Select at least one cleanup category or choose all follows.');
    }

    const current = await readEnvFile(envPath);
    const previousTarget = current.values.INSTAGRAM_USERNAME || current.values.FOLLOWING_URL || '';
    const nextTarget = account || followingUrl;
    await updateEnvFile(envPath, {
      INSTAGRAM_USERNAME: account,
      FOLLOWING_URL: followingUrl,
      CLEANUP_MODE: cleanupMode,
      CLEANUP_CATEGORIES: selectedCategories.join(','),
      SKIP_PERSONAL_ACCOUNTS: cleanupMode === 'all' || selectedCategories.includes('person_or_uncategorized') ? '0' : '1'
    });

    if (previousTarget && previousTarget !== nextTarget) {
      const statePath = path.join(rootDir, 'config', 'state.json');
      const nextState = {
        date: new Date().toISOString().slice(0, 10),
        targetAccount: nextTarget,
        unfollowedToday: 0,
        processedUsernames: {},
        lastSeenUsername: null,
        lastRunAt: new Date().toISOString()
      };
      await fs.promises.writeFile(statePath, JSON.stringify(nextState, null, 2) + '\n', 'utf8');
    }

    return json(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/scheduler') {
    const body = await readJson(req);
    const maxUnfollows = Number(body.maxUnfollows);
    if (!Number.isInteger(maxUnfollows) || maxUnfollows < 0 || maxUnfollows > 500) {
      throw new Error('Scheduled max unfollows must be an integer from 0 to 500.');
    }
    await updateEnvFile(envPath, {
      DAILY_MAX_UNFOLLOWS: String(maxUnfollows),
      DRY_RUN: body.live ? '0' : '1'
    });
    const schedule = await writeSchedule({
      rootDir,
      hour: Number(body.hour),
      minute: Number(body.minute)
    });
    return json(res, 200, { ok: true, schedule });
  }

  if (req.method === 'POST' && pathname === '/api/scheduler/install') {
    return json(res, 200, { ok: true, result: await installSchedule(rootDir) });
  }

  if (req.method === 'POST' && pathname === '/api/scheduler/enabled') {
    const body = await readJson(req);
    return json(res, 200, { ok: true, result: await setScheduleEnabled(Boolean(body.enabled)) });
  }

  if (req.method === 'POST' && pathname === '/api/scheduler/wake/install') {
    const schedule = readSchedule(rootDir);
    return json(res, 200, {
      ok: true,
      result: await installWakeSchedule({
        hour: schedule.hour,
        minute: schedule.minute
      })
    });
  }

  if (req.method === 'POST' && pathname === '/api/scheduler/wake/clear') {
    return json(res, 200, { ok: true, result: await clearWakeSchedule() });
  }

  return json(res, 404, { error: 'Not found' });
}

function serveStatic(res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(webDir, requested));
  if (!file.startsWith(webDir)) return text(res, 403, 'Forbidden');
  if (!fs.existsSync(file)) return text(res, 404, 'Not found');
  const ext = path.extname(file);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  };
  text(res, 200, fs.readFileSync(file), types[ext] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname);
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Local Instagram manager running at http://${HOST}:${PORT}`);
});
