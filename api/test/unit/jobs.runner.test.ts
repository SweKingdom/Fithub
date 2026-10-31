import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startIntervalJobs } from '../../src/jobs/runner.js';
import { createRecordingLogger } from '../helpers/fakes.js';

describe('interval job runner (US-128)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a job at its interval until stopped', async () => {
    const { logger } = createRecordingLogger();
    const run = vi.fn(async () => {});
    const stop = startIntervalJobs([{ name: 'a', intervalMs: 1000, run }], logger);

    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('skips a tick while the previous run is still busy', async () => {
    const { logger, entries } = createRecordingLogger();
    let release: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const stop = startIntervalJobs([{ name: 'slow', intervalMs: 1000, run }], logger);

    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(entries.filter((e) => e.message === 'job.skipped_busy')).toHaveLength(2);

    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it('logs a failing run and keeps the job going', async () => {
    const { logger, entries } = createRecordingLogger();
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const stop = startIntervalJobs([{ name: 'flaky', intervalMs: 1000, run }], logger);

    await vi.advanceTimersByTimeAsync(2000);

    expect(run).toHaveBeenCalledTimes(2);
    expect(entries.find((e) => e.message === 'job.failed')).toMatchObject({
      level: 'error',
      fields: { job: 'flaky', error: 'boom' },
    });
    stop();
  });
});
