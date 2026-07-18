const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig } = require('./lib/config');
const { removeStaleProfileLocks } = require('./lib/profile-locks');

async function main() {
  const args = process.argv.slice(2);
  const config = await loadConfig(args);

  if (config.browserMode === 'persistent') {
    const cleanup = removeStaleProfileLocks(config.chromeUserDataDir);
    const details = cleanup.removed.length ? ` removed=${cleanup.removed.length}` : '';
    console.log(`[detached-run] ${cleanup.reason}${details}`);
  }

  await fs.promises.mkdir(config.logDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(config.logDir, `detached-run-${stamp}.out.log`);
  const errPath = path.join(config.logDir, `detached-run-${stamp}.err.log`);
  const pidPath = path.join(config.rootDir, 'config', 'detached-run.pid');
  const metaPath = path.join(config.rootDir, 'config', 'detached-run.json');

  const out = fs.openSync(outPath, 'a');
  const err = fs.openSync(errPath, 'a');
  const childArgs = ['-dimsu', process.execPath, path.join('src', 'index.js'), ...args];
  const child = spawn('caffeinate', childArgs, {
    cwd: config.rootDir,
    env: process.env,
    detached: true,
    stdio: ['ignore', out, err]
  });

  child.unref();
  await fs.promises.writeFile(pidPath, `${child.pid}\n`, 'utf8');
  await fs.promises.writeFile(metaPath, JSON.stringify({
    pid: child.pid,
    startedAt: new Date().toISOString(),
    command: ['caffeinate', ...childArgs].join(' '),
    outPath,
    errPath,
    args
  }, null, 2) + '\n', 'utf8');

  console.log(`[detached-run] started pid=${child.pid}`);
  console.log(`[detached-run] stdout=${outPath}`);
  console.log(`[detached-run] stderr=${errPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
