const fs = require('fs');
const { localDateString } = require('./date');

const defaultState = {
  date: null,
  targetAccount: null,
  unfollowedToday: 0,
  processedUsernames: {},
  lastSeenUsername: null,
  lastRunAt: null
};

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
    return state;
  } catch (error) {
    logger?.info('state_init', { path: config.statePath });
    return {
      ...defaultState,
      date: localDateString(),
      targetAccount: config.instagramUsername || config.followingUrl || 'default'
    };
  }
}

async function saveState(config, state) {
  state.lastRunAt = new Date().toISOString();
  state.targetAccount = config.instagramUsername || config.followingUrl || 'default';
  await fs.promises.writeFile(config.statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

module.exports = { loadState, saveState };
