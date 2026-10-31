import type { Logger } from '../shared/logger.js';

/** Events the app tells members about. Ids only: no name, e-mail or other personal data (ADR-012). */
export type NotificationEvent = {
  type: 'waitlist_promoted';
  memberId: string;
  bookingId: string;
  classId: string;
};

/** Port for member notifications. Called after the transaction commits, never inside it. */
export interface Notifier {
  notify(event: NotificationEvent): Promise<void>;
}

/** Default notifier until a channel (e-mail, SMS) is decided: one structured log line per event. */
export class LogNotifier implements Notifier {
  constructor(private readonly logger: Logger) {}

  async notify(event: NotificationEvent): Promise<void> {
    this.logger.info(
      { memberId: event.memberId, bookingId: event.bookingId, classId: event.classId },
      `notification.${event.type}`,
    );
  }
}
