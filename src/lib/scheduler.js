const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawnSync } = require('child_process');

const LABEL = 'com.local.instagram-unfollow';
const DEFAULT_WAKE_LEAD_MINUTES = 5;

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
    installed: fs.existsSync(launchAgentPath()),
    wake: readWakeSchedule()
  };
}

function subtractMinutes(hour, minute, deltaMinutes) {
  const total = ((Number(hour) * 60 + Number(minute) - Number(deltaMinutes)) + (24 * 60)) % (24 * 60);
  return {
    hour: Math.floor(total / 60),
    minute: total % 60
  };
}

function formatClock(hour, minute) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function readWakeSchedule() {
  const result = spawnSync('/usr/bin/pmset', ['-g', 'sched'], {
    encoding: 'utf8',
    timeout: 5000
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const repeatLine = output.split(/\r?\n/).find((line) => /wakeorpoweron/i.test(line)) || '';
  return {
    available: result.status === 0,
    configured: Boolean(repeatLine),
    summary: repeatLine.trim(),
    raw: output.trim()
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
  const caffeinatePath = process.env.CAFFEINATE_PATH || '/usr/bin/caffeinate';
  const command = `cd ${rootDir} && ${caffeinatePath} -dimsu ${npmPath} run scheduled -- --live`;
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

function pmset(args) {
  return new Promise((resolve) => {
    execFile('/usr/bin/pmset', args, { timeout: 10000 }, (error, stdout, stderr) => {
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
  await launchctl(['bootout', `gui/${uid}/${LABEL}`]);
  await launchctl(['bootout', `gui/${uid}`, target]);
  let bootstrap = await launchctl(['bootstrap', `gui/${uid}`, target]);
  if (!bootstrap.ok) {
    await launchctl(['bootout', `gui/${uid}/${LABEL}`]);
    bootstrap = await launchctl(['bootstrap', `gui/${uid}`, target]);
  }
  const enable = await launchctl(['enable', `gui/${uid}/${LABEL}`]);
  return { bootstrap, enable, target };
}

async function setScheduleEnabled(enabled) {
  const uid = process.getuid ? process.getuid() : '';
  return launchctl([enabled ? 'enable' : 'disable', `gui/${uid}/${LABEL}`]);
}

async function installWakeSchedule({ hour, minute, leadMinutes = DEFAULT_WAKE_LEAD_MINUTES }) {
  const wake = subtractMinutes(hour, minute, leadMinutes);
  const time = formatClock(wake.hour, wake.minute);
  const result = await pmset(['repeat', 'wakeorpoweron', 'MTWRFSU', time]);
  return {
    ...result,
    requestedWakeTime: time,
    leadMinutes,
    note: result.ok
      ? 'Wake schedule installed. Keep the Mac plugged in and do not fully shut it down.'
      : 'pmset may require administrator permission on this Mac.'
  };
}

async function clearWakeSchedule() {
  return pmset(['repeat', 'cancel']);
}

module.exports = {
  LABEL,
  clearWakeSchedule,
  installWakeSchedule,
  readSchedule,
  writeSchedule,
  installSchedule,
  setScheduleEnabled
};
