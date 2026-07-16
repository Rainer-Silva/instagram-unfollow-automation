const fs = require('fs');

function parseEnv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index === -1) continue;
    values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return values;
}

async function readEnvFile(envPath) {
  const content = await fs.promises.readFile(envPath, 'utf8').catch(() => '');
  return {
    content,
    values: parseEnv(content)
  };
}

async function updateEnvFile(envPath, updates) {
  const { content } = await readEnvFile(envPath);
  const seen = new Set();
  const lines = content.split(/\r?\n/).map((line) => {
    const index = line.indexOf('=');
    if (index === -1) return line;
    const key = line.slice(0, index);
    if (!Object.prototype.hasOwnProperty.call(updates, key)) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      lines.push(`${key}=${value}`);
    }
  }

  await fs.promises.writeFile(envPath, lines.join('\n').replace(/\n*$/, '\n'), 'utf8');
}

module.exports = { parseEnv, readEnvFile, updateEnvFile };
