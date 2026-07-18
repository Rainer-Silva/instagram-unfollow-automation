const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');

function pidIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function countEvent(logPath, event) {
  if (!fs.existsSync(logPath)) return 0;
  return fs.readFileSync(logPath, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes(`,${event},`))
    .length;
}

async function main() {
  const config = await loadConfig(process.argv.slice(2));
  const pidPath = path.join(config.rootDir, 'config', 'detached-run.pid');
  const metaPath = path.join(config.rootDir, 'config', 'detached-run.json');
  const pid = fs.existsSync(pidPath) ? Number(fs.readFileSync(pidPath, 'utf8').trim()) : null;
  const state = readJson(config.statePath) || {};
  const date = new Date().toISOString().slice(0, 10);
  const logPath = path.join(config.logDir, `unfollow-actions-${date}.csv`);
  const meta = readJson(metaPath);

  console.log(JSON.stringify({
    running: pidIsAlive(pid),
    pid,
    detachedStartedAt: meta?.startedAt || null,
    targetAccount: state.targetAccount || config.instagramUsername,
    date: state.date || date,
    unfollowedToday: state.unfollowedToday || 0,
    maxUnfollows: config.dailyMaxUnfollows,
    lastSeenUsername: state.lastSeenUsername || null,
    lastRunAt: state.lastRunAt || null,
    loggedUnfollowComplete: countEvent(logPath, 'unfollow_complete'),
    logPath
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
