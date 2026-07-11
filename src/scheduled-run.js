const { spawn } = require('child_process');
const path = require('path');
const { loadConfig } = require('./lib/config');
const { removeStaleProfileLocks } = require('./lib/profile-locks');

async function main() {
  const args = process.argv.slice(2);
  const config = await loadConfig(args);

  if (config.browserMode === 'persistent') {
    const cleanup = removeStaleProfileLocks(config.chromeUserDataDir);
    const details = cleanup.removed.length ? ` removed=${cleanup.removed.length}` : '';
    console.log(`[scheduled-run] ${cleanup.reason}${details}`);
  }

  const child = spawn(process.execPath, [path.join('src', 'index.js'), ...args], {
    cwd: config.rootDir,
    env: process.env,
    stdio: 'inherit'
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[scheduled-run] child exited by signal ${signal}`);
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
