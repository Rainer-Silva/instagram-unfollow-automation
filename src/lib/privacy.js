const crypto = require('crypto');

function privacySalt(config) {
  return `${config.instagramUsername || config.followingUrl || 'default'}:${config.rootDir}`;
}

function usernameKey(config, username) {
  return crypto
    .createHash('sha256')
    .update(`${privacySalt(config)}:${String(username || '').toLowerCase()}`)
    .digest('hex')
    .slice(0, 24);
}

function publicUsername(config, username) {
  if (!config.redactUsernames) return username;
  return username ? '[redacted]' : '';
}

module.exports = { publicUsername, usernameKey };
