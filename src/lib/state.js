const fs = require('fs');
const path = require('path');
const { localDateString } = require('./date');

const defaultState = {
  date: null,
  targetAccount: null,
  unfollowedToday: 0,
  processedUsernames: {},
  lastSeenUsername: null,
  lastRunAt: null
};

function countLoggedUnfollows(config, date) {
  if (!config.logDir) return 0;
  const logPath = path.join(config.logDir, `unfollow-actions-${date}.csv`);
  try {
    return fs.readFileSync(logPath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.includes(',unfollow_complete,'))
      .length;
  } catch {
    return 0;
  }
}

function reconcileLoggedCount(config, state) {
  const loggedCount = countLoggedUnfollows(config, state.date || localDateString());
  if (loggedCount > Number(state.unfollowedToday || 0)) {
    state.unfollowedToday = loggedCount;
  }
  return state;
}

async function loadState(config, logger) {
  try {
    const raw = await fs.promises.readFile(config.statePath, 'utf8');
    const parsed = JSON.parse(raw);
    const today = localDateString();
    const targetAccount = config.instagramUsername || config.followingUrl || 'default';
    if (parsed.date !== today || (parsed.targetAccount && parsed.targetAccount !== targetAccount)) {
      return { ...defaultState, date: today, targetAccount };
    }
    const state = { ...defaultState, targetAccount, ...parsed };
    if (!config.storeSkippedUsernames) {
      state.processedUsernames = Object.fromEntries(
        Object.entries(state.processedUsernames || {})
          .filter(([, value]) => value?.status === 'unfollowed')
      );
    }
    return reconcileLoggedCount(config, state);
  } catch (error) {
    logger?.info('state_init', { path: config.statePath });
    return reconcileLoggedCount(config, {
      ...defaultState,
      date: localDateString(),
      targetAccount: config.instagramUsername || config.followingUrl || 'default'
    });
  }
}

async function saveState(config, state) {
  state.lastRunAt = new Date().toISOString();
  state.targetAccount = config.instagramUsername || config.followingUrl || 'default';
  await fs.promises.writeFile(config.statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

module.exports = { loadState, saveState };
