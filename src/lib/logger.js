const fs = require('fs');
const path = require('path');
const { localDateString } = require('./date');
const { publicUsername } = require('./privacy');

function csvEscape(value) {
  const str = value === undefined || value === null ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function nowIso() {
  return new Date().toISOString();
}

function createLogger(config) {
  const date = localDateString();
  const csvPath = path.join(config.logDir, `unfollow-actions-${date}.csv`);
  const stream = fs.createWriteStream(csvPath, { flags: 'a' });
  let headerWritten = fs.existsSync(csvPath) && fs.statSync(csvPath).size > 0;

  function sanitizePayload(payload = {}) {
    if (!config.redactUsernames) return payload;
    const sanitized = { ...payload };
    if (Object.prototype.hasOwnProperty.call(sanitized, 'username')) {
      sanitized.username = publicUsername(config, sanitized.username);
    }
    return sanitized;
  }

  function writeCsv(row) {
    if (!headerWritten) {
      stream.write([
        'timestamp',
        'level',
        'event',
        'username',
        'action',
        'reason',
        'details'
      ].join(',') + '\n');
      headerWritten = true;
    }
    stream.write([
      csvEscape(row.timestamp || nowIso()),
      csvEscape(row.level || 'info'),
      csvEscape(row.event || ''),
      csvEscape(row.username || ''),
      csvEscape(row.action || ''),
      csvEscape(row.reason || ''),
      csvEscape(row.details || '')
    ].join(',') + '\n');
  }

  function log(level, event, payload = {}) {
    const safePayload = sanitizePayload(payload);
    const entry = {
      timestamp: nowIso(),
      level,
      event,
      ...safePayload
    };
    writeCsv(entry);
    if (config.debug || level !== 'debug') {
      const suffix = Object.keys(safePayload).length ? ` ${JSON.stringify(safePayload)}` : '';
      console.log(`[${entry.timestamp}] ${level.toUpperCase()} ${event}${suffix}`);
    }
  }

  return {
    info: (event, payload) => log('info', event, payload),
    warn: (event, payload) => log('warn', event, payload),
    error: (event, payload) => log('error', event, payload),
    debug: (event, payload) => log('debug', event, payload),
    close: async () => {
      await new Promise((resolve) => stream.end(resolve));
    },
    csvPath
  };
}

module.exports = { createLogger };
