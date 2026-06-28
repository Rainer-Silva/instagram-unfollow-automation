const fs = require('fs');

const defaultState = {
  date: null,
  unfollowedToday: 0,
  processedUsernames: {},
  lastSeenUsername: null,
  lastRunAt: null
};

async function loadState(config, logger) {
  try {
    const raw = await fs.promises.readFile(config.statePath, 'utf8');
    const parsed = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (parsed.date !== today) {
      return { ...defaultState, date: today };
    }
    return { ...defaultState, ...parsed };
  } catch (error) {
    logger?.info('state_init', { path: config.statePath });
    return { ...defaultState, date: new Date().toISOString().slice(0, 10) };
  }
}

async function saveState(config, state) {
  state.lastRunAt = new Date().toISOString();
  await fs.promises.writeFile(config.statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

module.exports = { loadState, saveState };
