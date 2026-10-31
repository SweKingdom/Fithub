import { buildApp } from './app.js';
import { ConfigError, describePayments, loadConfig, type AppConfig } from './config.js';

const DEFAULT_PORT = 3000;

/** Process entry point: validates the configuration, logs the payment state once and starts listening. */
async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  console.log(describePayments(config.payments));

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.');
    process.exit(1);
  }

  const app = await buildApp({ config });
  const shutdown = (): void => {
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });
}

main().catch((error: unknown) => {
  console.error('The API could not start:', (error as Error).message);
  process.exit(1);
});
