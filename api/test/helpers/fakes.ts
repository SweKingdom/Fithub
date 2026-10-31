import type { NotificationEvent, Notifier } from '../../src/notifications/notifier.js';
import type { Logger } from '../../src/shared/logger.js';

/** Records every `notify` call. Set `failWith` to make it throw (the call is still recorded). */
export class FakeNotifier implements Notifier {
  readonly calls: NotificationEvent[] = [];
  failWith: Error | null = null;

  async notify(event: NotificationEvent): Promise<void> {
    this.calls.push(event);
    if (this.failWith) throw this.failWith;
  }
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
  message: string | undefined;
}

/** A logger that keeps what it was given, so a test can assert on it. */
export function createRecordingLogger(): { logger: Logger; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const record =
    (level: LogEntry['level']) =>
    (fields: object, message?: string): void => {
      entries.push({ level, fields: fields as Record<string, unknown>, message });
    };
  return { logger: { info: record('info'), warn: record('warn'), error: record('error') }, entries };
}
