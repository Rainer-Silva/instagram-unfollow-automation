const { loadConfig } = require('./lib/config');
const { createLogger } = require('./lib/logger');
const { loadState } = require('./lib/state');
const { generateDailyReport } = require('./lib/report');

async function main() {
  const config = await loadConfig([]);
  const logger = createLogger(config);
  const state = await loadState(config, logger);
  const report = await generateDailyReport({
    config,
    logger,
    state,
    result: { completed: true }
  });
  await logger.close();
  console.log(report);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
