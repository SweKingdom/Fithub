import { buildApp } from './app.js';
import { ConfigError, describePayments, loadConfig, type AppConfig } from './config.js';
import { createDbFromEnv } from './db/client.js';
import { startIntervalJobs } from './jobs/runner.js';
import { startAutoNoShowSweeper } from './modules/attendance/auto-no-show.js';
import { runWaitlistMaintenance } from './modules/waitlist/maintenance.js';
import { systemClock } from './shared/clock.js';
import { DomainEventBus } from './shared/domain-events.js';

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

  // The jobs and the sweeper need the same database connection (and event bus) as the app, so they are created here.
  const db = createDbFromEnv();
  const events = new DomainEventBus();
  const app = await buildApp({ config, db, events });

  let stopJobs = (): void => {};
  if (config.jobs.enabled) {
    stopJobs = startIntervalJobs(
      [
        {
          name: 'waitlist-maintenance',
          intervalMs: config.waitlist.jobIntervalSeconds * 1000,
          run: async () => {
            await runWaitlistMaintenance({
              db,
              clock: systemClock,
              config: config.waitlist,
              notifier: app.notifier,
              logger: app.log,
            });
          },
        },
      ],
      app.log,
    );
  }

  let stopSweeper: (() => void) | null = null;
  const shutdown = (): void => {
    stopJobs();
    stopSweeper?.();
    void app
      .close()
      .then(() => db.destroy())
      .then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port, host: process.env.HOST ?? '0.0.0.0' });

  if (config.attendance.autoNoShowEnabled) {
    stopSweeper = startAutoNoShowSweeper({
      db,
      clock: systemClock,
      events,
      config: config.attendance,
      logger: app.log,
    });
    console.log(`attendance.autoNoShow=enabled sweep every ${config.attendance.sweepIntervalMinutes} min`);
  }
}

main().catch((error: unknown) => {
  console.error('The API could not start:', (error as Error).message);
  process.exit(1);
});
