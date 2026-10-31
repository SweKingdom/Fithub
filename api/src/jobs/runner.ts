import type { Logger } from '../shared/logger.js';

export interface IntervalJob {
  name: string;
  intervalMs: number;
  run(): Promise<void>;
}

/**
 * Starts in-process interval jobs (ADR-007). A job never overlaps itself: a tick is skipped while the previous run
 * is still busy. A failing run is logged and never stops the job or crashes the process.
 * Returns `stop()`, which cancels every timer (runs already in progress finish on their own).
 */
export function startIntervalJobs(jobs: readonly IntervalJob[], logger: Logger): () => void {
  const timers = jobs.map((job) => {
    let busy = false;
    return setInterval(() => {
      if (busy) {
        logger.warn({ job: job.name }, 'job.skipped_busy');
        return;
      }
      busy = true;
      job
        .run()
        .catch((error: unknown) => {
          logger.error({ job: job.name, error: error instanceof Error ? error.message : String(error) }, 'job.failed');
        })
        .finally(() => {
          busy = false;
        });
    }, job.intervalMs);
  });
  return () => {
    for (const timer of timers) clearInterval(timer);
  };
}
