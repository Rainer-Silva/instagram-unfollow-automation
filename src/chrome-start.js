const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const rootDir = process.cwd();
const userDataDir = process.env.CHROME_USER_DATA_DIR || path.join(rootDir, 'work/chrome-profile');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const remotePort = process.env.CHROME_REMOTE_DEBUGGING_PORT || '9222';
const profileDir = process.env.CHROME_PROFILE_DIR || 'Default';

fs.mkdirSync(userDataDir, { recursive: true });

const args = [
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${userDataDir}`,
  `--profile-directory=${profileDir}`,
  '--new-window',
  '--no-first-run',
  '--no-default-browser-check'
];

const child = spawn(chromePath, args, {
  detached: true,
  stdio: 'ignore'
});

child.unref();

console.log(`Started Chrome with remote debugging on port ${remotePort}`);
console.log(`User data dir: ${userDataDir}`);
console.log(`Profile directory: ${profileDir}`);
console.log(`Chrome binary assumed at: ${chromePath}`);
