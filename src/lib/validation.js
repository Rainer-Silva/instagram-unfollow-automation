const KNOWN_CLEANUP_CATEGORIES = Object.freeze([
  'instagram_business_or_creator_category',
  'selling_or_product_page',
  'public_or_general_page',
  'person_or_uncategorized',
  'mutual_friends_last'
]);

const DEFAULT_UNFOLLOW_LIMIT = 50;
const MAX_USER_UNFOLLOWS = 500;

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseInteger(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : defaultValue;
}

function assertIntegerRange(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
}

function validateInstagramUsername(value, { required = false } = {}) {
  const username = String(value || '').trim().replace(/^@/, '').toLowerCase();
  if (!username) {
    if (required) throw new Error('Instagram username is required.');
    return '';
  }
  if (!/^[a-z0-9._]{1,30}$/.test(username)) {
    throw new Error('Instagram username can only contain letters, numbers, dots, and underscores.');
  }
  return username;
}

function validateInstagramUrl(value, { allowEmpty = true } = {}) {
  const raw = String(value || '').trim();
  if (!raw) {
    if (allowEmpty) return '';
    throw new Error('Instagram URL is required.');
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('FOLLOWING_URL must be a valid HTTPS Instagram URL.');
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(hostname)) {
    throw new Error('FOLLOWING_URL must use https://instagram.com or https://www.instagram.com only.');
  }
  return url.toString();
}

function validateCleanupMode(value) {
  const mode = value || 'categories';
  if (!['all', 'categories'].includes(mode)) {
    throw new Error('CLEANUP_MODE must be either all or categories.');
  }
  return mode;
}

function validateCleanupCategories(categories, mode = 'categories') {
  const selected = Array.isArray(categories) ? categories : [];
  const unknown = selected.filter((category) => !KNOWN_CLEANUP_CATEGORIES.includes(category));
  if (unknown.length) {
    throw new Error(`Unknown cleanup category: ${unknown.join(', ')}`);
  }
  if (mode === 'categories' && selected.length === 0) {
    throw new Error('Select at least one cleanup category or choose all follows.');
  }
  return selected;
}

function validateTiming(config) {
  if (!Number.isInteger(config.minDelaySeconds) || config.minDelaySeconds < 5) {
    throw new Error('MIN_DELAY_SECONDS must be an integer greater than or equal to 5.');
  }
  if (!Number.isInteger(config.maxDelaySeconds) || config.maxDelaySeconds < config.minDelaySeconds) {
    throw new Error('MAX_DELAY_SECONDS must be greater than or equal to MIN_DELAY_SECONDS.');
  }
  if (!Number.isInteger(config.batchSize) || config.batchSize <= 0) {
    throw new Error('BATCH_SIZE must be an integer greater than 0.');
  }
  if (!Number.isInteger(config.batchCooldownMinutesMin) || config.batchCooldownMinutesMin < 0) {
    throw new Error('BATCH_COOLDOWN_MINUTES must be a non-negative integer.');
  }
  if (!Number.isInteger(config.batchCooldownMinutesMax) || config.batchCooldownMinutesMax < config.batchCooldownMinutesMin) {
    throw new Error('BATCH_COOLDOWN_MAX_MINUTES must be greater than or equal to BATCH_COOLDOWN_MINUTES.');
  }
}

function validateRunLimit(value, name = 'DAILY_MAX_UNFOLLOWS') {
  assertIntegerRange(name, value, 0, MAX_USER_UNFOLLOWS);
  return value;
}

function assertLiveConfirmed(config) {
  if (!config.dryRun && !config.confirmLive) {
    throw new Error('Live mode requires explicit confirmation. Run: npm run live -- --confirm-live');
  }
}

module.exports = {
  KNOWN_CLEANUP_CATEGORIES,
  DEFAULT_UNFOLLOW_LIMIT,
  MAX_USER_UNFOLLOWS,
  parseBoolean,
  parseInteger,
  validateInstagramUsername,
  validateInstagramUrl,
  validateCleanupMode,
  validateCleanupCategories,
  validateTiming,
  validateRunLimit,
  assertLiveConfirmed
};
