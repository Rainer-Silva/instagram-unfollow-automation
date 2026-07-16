const { loadConfig } = require('./lib/config');
const { createLogger } = require('./lib/logger');
const { loadState, saveState } = require('./lib/state');
const { createBrowser } = require('./lib/browser');
const { runUnfollowRoutine } = require('./lib/runner');
const { generateDailyReport } = require('./lib/report');
const { assertLiveConfirmed } = require('./lib/validation');

async function main() {
  const config = await loadConfig(process.argv.slice(2));
  assertLiveConfirmed(config);
  const logger = createLogger(config);
  const state = await loadState(config, logger);
  let browser;

  let exitCode = 0;
  try {
    browser = await createBrowser(config, logger);
    const result = await runUnfollowRoutine({ config, logger, state, browser });
    await saveState(config, state);
    await generateDailyReport({ config, logger, state, result });
  } catch (error) {
    exitCode = 1;
    logger.error('run_failed', { message: error.message, stack: error.stack });
    if (browser?.page) {
      const { saveErrorScreenshot } = require('./lib/runner');
      await saveErrorScreenshot(browser, config, 'error').then((file) => {
        logger.warn('screenshot_saved', { file });
      }).catch(() => {});
    }
    await saveState(config, state).catch(() => {});
    try {
      await generateDailyReport({ config, logger, state, result: { completed: false, failed: true } });
    } catch (reportError) {
      logger.error('report_failed', { message: reportError.message });
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await logger.close();
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
