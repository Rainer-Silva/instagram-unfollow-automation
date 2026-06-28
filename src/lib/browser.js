const { chromium } = require('playwright');

async function createBrowser(config, logger) {
  if (config.browserMode === 'persistent') {
    logger.info('browser_launching_persistent', { userDataDir: config.chromeUserDataDir });
    const context = await chromium.launchPersistentContext(config.chromeUserDataDir, {
      channel: 'chrome',
      headless: false,
      viewport: null,
      ignoreDefaultArgs: ['--no-sandbox'],
      args: [
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });
    const page = context.pages()[0] || await context.newPage();
    return {
      context,
      page,
      close: async () => {
        await context.close();
      }
    };
  }

  if (!config.chromeRemoteDebuggingUrl) {
    throw new Error('Set CHROME_REMOTE_DEBUGGING_URL and start Chrome with remote debugging before running the automation.');
  }

  logger.info('browser_connecting_cdp', { url: config.chromeRemoteDebuggingUrl });
  let browser;
  let lastError;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      browser = await chromium.connectOverCDP(config.chromeRemoteDebuggingUrl);
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!browser) {
    throw lastError;
  }
  const context = browser.contexts()[0] || await browser.newContext();
  const page = context.pages()[0] || await context.newPage();
  return {
    context,
    page,
    close: async () => {
      // Keep the user's visible Chrome session open; this CDP connection is disposable.
    }
  };
}

module.exports = { createBrowser };
