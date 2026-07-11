'use strict';

/**
 * src/lib/notion.js
 *
 * Thin wrapper around the Notion REST API.
 * Logs each unfollowed account as a new page (row) in a Notion database.
 *
 * Configuration is read from config/notion.json — never from .env or
 * hardcoded values — so the token stays out of source control entirely.
 *
 * The integration is opt-in and non-fatal: if config/notion.json is absent,
 * incomplete, or unreachable, a single warning is written to stderr and the
 * automation continues unaffected.
 *
 * Requires Node 18+ for native fetch. On Node 16, install node-fetch v2 and
 * replace the fetch() calls below with require('node-fetch').
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Internal config cache
// ---------------------------------------------------------------------------

let _cachedConfig = undefined; // undefined = not yet attempted; null = attempted but absent

/**
 * Load and cache config/notion.json.
 * Returns the parsed object on success, or null if the file is missing,
 * unparseable, or missing required fields.
 *
 * @param {string} rootDir - absolute path to the project root (config.rootDir)
 * @returns {{ token: string, database_id: string } | null}
 */
function loadNotionConfig(rootDir) {
  if (_cachedConfig !== undefined) return _cachedConfig;

  const configPath = path.resolve(rootDir || process.cwd(), 'config/notion.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg.token && cfg.database_id) {
      _cachedConfig = cfg;
    } else {
      process.stderr.write('[notion] config/notion.json is missing "token" or "database_id" — Notion logging disabled.\n');
      _cachedConfig = null;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // File exists but is malformed — warn explicitly
      process.stderr.write(`[notion] Could not parse config/notion.json: ${err.message}\n`);
    }
    // ENOENT = file simply not created yet — silent skip
    _cachedConfig = null;
  }

  return _cachedConfig;
}

// ---------------------------------------------------------------------------
// Notion REST API
// ---------------------------------------------------------------------------

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION  = '2022-06-28';

/**
 * Create a new page in the configured Notion database representing one
 * unfollow action.
 *
 * Database schema expected (column names must match exactly):
 *   Account Handle  — Title
 *   Date            — Date
 *   Dry Run         — Checkbox
 *   Category        — Text (rich_text)
 *
 * @param {object}  opts
 * @param {string}  opts.rootDir      - project root directory (config.rootDir)
 * @param {string}  opts.handle       - Instagram username, e.g. "acme_store"
 * @param {string}  opts.unfollowedAt - ISO-8601 timestamp of the action
 * @param {boolean} opts.dryRun       - true when this was a dry-run candidate
 * @param {string}  [opts.category]   - account category label (optional)
 * @returns {Promise<void>}
 */
async function logUnfollowToNotion({ rootDir, handle, unfollowedAt, dryRun, category }) {
  const cfg = loadNotionConfig(rootDir);
  if (!cfg) return; // not configured — skip silently

  const body = {
    parent: { database_id: cfg.database_id },
    properties: {
      'Account Handle': {
        title: [{ text: { content: handle } }]
      },
      'Date': {
        date: { start: unfollowedAt }
      },
      'Dry Run': {
        checkbox: Boolean(dryRun)
      },
      'Category': {
        rich_text: [{ text: { content: category || '' } }]
      }
    }
  };

  try {
    const response = await fetch(`${NOTION_API_BASE}/pages`, {
      method: 'POST',
      headers: {
        Authorization:    `Bearer ${cfg.token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type':   'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '(no body)');
      process.stderr.write(
        `[notion] Failed to log "${handle}" — HTTP ${response.status}: ${text}\n`
      );
    }
  } catch (err) {
    // Network error — non-fatal, automation continues
    process.stderr.write(`[notion] Network error while logging "${handle}": ${err.message}\n`);
  }
}

// Exported for unit-testing the config loader independently
module.exports = { logUnfollowToNotion, loadNotionConfig };
