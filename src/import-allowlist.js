const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { normalizeUsername } = require('./lib/instagram');

const usernameKeys = new Set([
  'username',
  'sender_name',
  'title',
  'name',
  'value',
  'href'
]);

function walk(value, usernames) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, usernames);
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && usernameKeys.has(key)) {
      const extracted = item.match(/(?:instagram\.com\/)?@?([a-zA-Z0-9._]{2,30})/);
      if (extracted) usernames.add(normalizeUsername(extracted[1]));
    } else {
      walk(item, usernames);
    }
  }
}

async function findJsonFiles(rootDir) {
  const files = [];
  async function visit(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }
  await visit(rootDir);
  return files;
}

function isRelevantExportFile(filePath) {
  const normalized = filePath.toLowerCase();
  return [
    'messages',
    'comments',
    'likes',
    'story',
    'stories',
    'recently_viewed',
    'followers_and_following'
  ].some((part) => normalized.includes(part));
}

async function main() {
  const config = await loadConfig([]);
  const exportDir = process.argv[2];
  if (!exportDir) {
    throw new Error('Usage: node src/import-allowlist.js /path/to/instagram-export');
  }

  const resolvedExportDir = path.resolve(exportDir);
  const jsonFiles = (await findJsonFiles(resolvedExportDir)).filter(isRelevantExportFile);
  const usernames = new Set();

  for (const file of jsonFiles) {
    const parsed = JSON.parse(await fs.promises.readFile(file, 'utf8'));
    walk(parsed, usernames);
  }

  usernames.delete(normalizeUsername(config.instagramUsername));
  const existing = new Set();
  try {
    const raw = await fs.promises.readFile(config.allowlistPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const cleaned = normalizeUsername(line.replace(/#.*/, ''));
      if (cleaned) existing.add(cleaned);
    }
  } catch {
    // Created below.
  }

  const merged = new Set([...existing, ...usernames]);
  const output = [
    '# One Instagram username per line.',
    '# These accounts will never be unfollowed.',
    '',
    ...[...merged].sort()
  ].join('\n') + '\n';

  await fs.promises.mkdir(path.dirname(config.allowlistPath), { recursive: true });
  await fs.promises.writeFile(config.allowlistPath, output, 'utf8');
  console.log(`Imported ${usernames.size} usernames from ${jsonFiles.length} export files.`);
  console.log(`Allowlist now contains ${merged.size} usernames: ${config.allowlistPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
