const fs = require('fs');
const os = require('os');
const path = require('path');

function parsePidFromSingletonLock(lockPath) {
  try {
    const link = fs.readlinkSync(lockPath);
    const match = link.match(/-(\d+)$/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function pidIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function removeIfExists(file, removed) {
  try {
    fs.rmSync(file, { force: true, recursive: false });
    removed.push(file);
  } catch {
    // Best effort cleanup. Chrome will fail safely if the profile is still locked.
  }
}

function removeStaleProfileLocks(userDataDir) {
  const root = path.resolve(userDataDir);
  const lockPath = path.join(root, 'SingletonLock');
  const pid = parsePidFromSingletonLock(lockPath);
  const lockLooksCurrent = pid && pidIsAlive(pid);
  if (lockLooksCurrent) {
    return {
      skipped: true,
      reason: `Chrome profile appears active at pid ${pid}`,
      removed: []
    };
  }

  const removed = [];
  for (const file of [
    path.join(root, 'SingletonLock'),
    path.join(root, 'SingletonSocket'),
    path.join(root, 'SingletonCookie'),
    path.join(root, 'RunningChromeVersion'),
    path.join(root, 'Default', 'LOCK')
  ]) {
    removeIfExists(file, removed);
  }

  return {
    skipped: false,
    reason: pid ? `Removed stale Chrome locks for pid ${pid}` : 'Removed stale Chrome locks',
    removed
  };
}

function defaultProfileDir(rootDir) {
  return path.join(rootDir, 'work', 'chrome-automation-profile');
}

function profileLockSummary(userDataDir) {
  const root = path.resolve(userDataDir);
  const lockPath = path.join(root, 'SingletonLock');
  const pid = parsePidFromSingletonLock(lockPath);
  return {
    host: os.hostname(),
    userDataDir: root,
    singletonLockPid: pid,
    singletonLockAlive: pidIsAlive(pid)
  };
}

module.exports = {
  defaultProfileDir,
  profileLockSummary,
  removeStaleProfileLocks
};
