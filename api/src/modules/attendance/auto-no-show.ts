import type { Kysely } from 'kysely';
import type { AttendanceConfig } from '../../config.js';
import type { Database } from '../../db/schema.js';
import type { Clock } from '../../shared/clock.js';
import type { EventPublisher } from '../../shared/domain-events.js';
import {
  findClassesDueForAutoNoShow,
  lockClassSkipLocked,
  lockUnrecordedBookings,
  updateAttendance,
} from './repository.js';
import { attendanceWindow } from './window.js';

const BATCH_SIZE = 50;
const MINUTE_MS = 60 * 1000;

export interface AutoNoShowLogger {
  error(context: object, message: string): void;
}

export interface AutoNoShowDeps {
  db: Kysely<Database>;
  clock: Clock;
  events: EventPublisher;
  config: AttendanceConfig;
  logger: AutoNoShowLogger;
}

export interface SweepResult {
  /** Classes that had at least one booking set to `no_show`. */
  classes: number;
  /** Bookings set to `no_show`. */
  bookings: number;
}

/** One class in its own transaction. Returns how many bookings changed; 0 when another instance holds the class. */
async function sweepClass(deps: AutoNoShowDeps, classId: string, now: Date): Promise<number> {
  return deps.db.transaction().execute(async (trx) => {
    const gymClass = await lockClassSkipLocked(trx, classId);
    // Locked by someone else, or changed since the candidate query: leave it for the next run.
    if (!gymClass || gymClass.status !== 'scheduled') return 0;
    if (attendanceWindow(gymClass, now, deps.config.editWindowHours).state !== 'closed') return 0;

    const bookings = await lockUnrecordedBookings(trx, classId);
    for (const booking of bookings) {
      await updateAttendance(trx, booking.id, 'no_show', null, now);
      await deps.events.publish(trx, {
        type: 'AttendanceRecorded',
        bookingId: booking.id,
        memberId: booking.member_id,
        classId,
        classStartAt: gymClass.start_at,
        previousAttendance: booking.attendance,
        attendance: 'no_show',
        recordedBy: null,
        recordedAt: now,
      });
    }
    return bookings.length;
  });
}

/**
 * Turns bookings that are still `unknown` after the attendance window into `no_show`, only when
 * `ATTENDANCE_AUTO_NO_SHOW_ENABLED=true`. Idempotent: only `unknown` rows are touched. A failing class
 * is logged with its id and the sweep continues with the next one.
 */
export async function runAutoNoShowSweep(deps: AutoNoShowDeps): Promise<SweepResult> {
  const result: SweepResult = { classes: 0, bookings: 0 };
  if (!deps.config.autoNoShowEnabled) return result;

  const now = deps.clock.now();
  const classIds = await findClassesDueForAutoNoShow(deps.db, now, deps.config.editWindowHours, BATCH_SIZE);
  for (const classId of classIds) {
    try {
      const changed = await sweepClass(deps, classId, now);
      if (changed > 0) {
        result.classes += 1;
        result.bookings += changed;
      }
    } catch (error) {
      deps.logger.error({ err: error, classId }, 'auto no-show sweep failed for class');
    }
  }
  return result;
}

/** Runs the sweep every `sweepIntervalMinutes`; never two runs at once. Returns `stop()`. */
export function startAutoNoShowSweeper(deps: AutoNoShowDeps): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runAutoNoShowSweep(deps)
      .catch((error: unknown) => {
        deps.logger.error({ err: error }, 'auto no-show sweep failed');
      })
      .finally(() => {
        running = false;
      });
  }, deps.config.sweepIntervalMinutes * MINUTE_MS);
  timer.unref();
  return () => clearInterval(timer);
}
