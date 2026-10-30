import { ConfigError, describePayments, loadConfig } from './config.js';

/** Process entry point: validates the configuration and logs the payment state once. */
function main(): void {
  try {
    const config = loadConfig();
    console.log(describePayments(config.payments));
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

main();
