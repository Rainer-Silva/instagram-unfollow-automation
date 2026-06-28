const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const LABEL = 'com.local.instagram-unfollow';

function launchAgentPath() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function plistPath(rootDir) {
  return path.join(rootDir, 'config', 'launchd', `${LABEL}.plist`);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function readSchedule(rootDir) {
  const file = plistPath(rootDir);
  const xml = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const hourMatch = xml.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
  const minuteMatch = xml.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/);
  return {
    label: LABEL,
    plistPath: file,
    launchAgentPath: launchAgentPath(),
    hour: hourMatch ? Number(hourMatch[1]) : 9,
    minute: minuteMatch ? Number(minuteMatch[1]) : 0,
    installed: fs.existsSync(launchAgentPath())
  };
}

async function writeSchedule({ rootDir, hour, minute }) {
  const normalizedHour = Number(hour);
  const normalizedMinute = Number(minute);
  if (!Number.isInteger(normalizedHour) || normalizedHour < 0 || normalizedHour > 23) {
    throw new Error('Schedule hour must be an integer from 0 to 23.');
  }
  if (!Number.isInteger(normalizedMinute) || normalizedMinute < 0 || normalizedMinute > 59) {
    throw new Error('Schedule minute must be an integer from 0 to 59.');
  }

  const npmPath = process.env.NPM_PATH || '/opt/homebrew/bin/npm';
  const command = `cd ${rootDir} && ${npmPath} run live`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${escapeXml(command)}</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>CHROME_USER_DATA_DIR</key>
    <string>${escapeXml(path.join(rootDir, 'work', 'chrome-automation-profile'))}</string>
    <key>BROWSER_MODE</key>
    <string>persistent</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>${escapeXml(rootDir)}</string>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${normalizedHour}</integer>
    <key>Minute</key>
    <integer>${normalizedMinute}</integer>
  </dict>

  <key>StandardOutPath</key>
  <string>${escapeXml(path.join(rootDir, 'logs', 'launchd.out.log'))}</string>

  <key>StandardErrorPath</key>
  <string>${escapeXml(path.join(rootDir, 'logs', 'launchd.err.log'))}</string>
</dict>
</plist>
`;

  const file = plistPath(rootDir);
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await fs.promises.writeFile(file, xml, 'utf8');
  return readSchedule(rootDir);
}

function launchctl(args) {
  return new Promise((resolve) => {
    execFile('/bin/launchctl', args, { timeout: 10000 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        stdout: String(stdout || ''),
        stderr: String(stderr || '')
      });
    });
  });
}

async function installSchedule(rootDir) {
  const source = plistPath(rootDir);
  const target = launchAgentPath();
  await fs.promises.mkdir(path.dirname(target), { recursive: true });
  await fs.promises.copyFile(source, target);
  const uid = process.getuid ? process.getuid() : '';
  await launchctl(['bootout', `gui/${uid}`, target]);
  const bootstrap = await launchctl(['bootstrap', `gui/${uid}`, target]);
  const enable = await launchctl(['enable', `gui/${uid}/${LABEL}`]);
  return { bootstrap, enable, target };
}

async function setScheduleEnabled(enabled) {
  const uid = process.getuid ? process.getuid() : '';
  return launchctl([enabled ? 'enable' : 'disable', `gui/${uid}/${LABEL}`]);
}

module.exports = {
  LABEL,
  readSchedule,
  writeSchedule,
  installSchedule,
  setScheduleEnabled
};
