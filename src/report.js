const { loadConfig } = require('./lib/config');
const { loadState } = require('./lib/state');
const { generateDailyReport } = require('./lib/report');

async function main() {
  const config = await loadConfig(process.argv.slice(2));
  const logger = {
    info: (event, payload = {}) => {
      if (event === 'report_written') {
        console.log(`report_written ${payload.reportPath}`);
      }
    },
    warn: () => {},
    error: () => {},
    debug: () => {}
  };
  const state = await loadState(config, logger);
  const report = await generateDailyReport({
    config,
    logger,
    state,
    result: { completed: true }
  });
  console.log(report);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
