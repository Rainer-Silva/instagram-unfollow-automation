const fs = require('fs');
const path = require('path');

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

function loadDailyRows(logPath) {
  if (!fs.existsSync(logPath)) return [];
  const content = fs.readFileSync(logPath, 'utf8').trim();
  if (!content) return [];
  const lines = content.split(/\r?\n/);
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return row;
  });
}

async function generateDailyReport({ config, logger, state, result }) {
  const date = new Date().toISOString().slice(0, 10);
  const logPath = path.join(config.logDir, `unfollow-actions-${date}.csv`);
  const reportPath = path.join(config.reportDir, `daily-summary-${date}.md`);
  const rows = loadDailyRows(logPath);

  const counts = rows.reduce((acc, row) => {
    acc[row.event] = (acc[row.event] || 0) + 1;
    return acc;
  }, {});

  const lines = [
    `# Daily Summary ${date}`,
    '',
    `- Dry run: ${config.dryRun ? 'yes' : 'no'}`,
    `- Daily unfollow limit: ${config.dailyMaxUnfollows}`,
    `- Unfollowed today: ${state.unfollowedToday}`,
    `- Last processed username: ${state.lastSeenUsername || 'none'}`,
    `- Run completed: ${result?.completed ? 'yes' : 'no'}`,
    '',
    '## Event Counts',
    '',
    ...Object.keys(counts).sort().map((key) => `- ${key}: ${counts[key]}`),
    '',
    '## Notes',
    '',
    '- Check `logs/` for the CSV log.',
    '- Check `screenshots/` if the run stopped on an error or safety warning.'
  ];

  await fs.promises.writeFile(reportPath, lines.join('\n') + '\n', 'utf8');
  logger.info('report_written', { reportPath });
  return reportPath;
}

module.exports = { generateDailyReport };
