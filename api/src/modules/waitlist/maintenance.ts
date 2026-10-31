import type { Kysely } from 'kysely';
import type { WaitlistConfig } from '../../config.js';
import type { Database } from '../../db/schema.js';
import type { Notifier } from '../../notifications/notifier.js';
import type { Clock } from '../../shared/clock.js';
import type { Logger } from '../../shared/logger.js';
import { notifyPromotions, promoteNext } from './promotion.js';
import { expireEntries, findClassesNeedingPromotion } from './repository.js';

export interface WaitlistMaintenanceDeps {
  db: Kysely<Database>;
  clock: Clock;
  config: WaitlistConfig;
  notifier: Notifier;
  logger: Logger;
  /** `config.payments.enabled`: while false, drop-in members stay on the waiting list (US-132). */
  paymentsEnabled?: boolean;
}

export interface WaitlistMaintenanceResult {
  expired: number;
  promoted: number;
}

/**
 * The `waitlist-maintenance` job. Step 1 expires the `waiting` entries of classes that reached the promotion
 * cut-off. Step 2 is the safety net: classes with a free place and someone waiting get their promotion (missed
 * triggers, members who became eligible again). Idempotent and safe on several instances: expiry is a single
 * statement and promotion is serialised by the class lock.
 */
export async function runWaitlistMaintenance(deps: WaitlistMaintenanceDeps): Promise<WaitlistMaintenanceResult> {
  const { db, clock, config, notifier, logger, paymentsEnabled } = deps;
  const cutoff = config.promotionCutoffMinutes;

  const expired = await expireEntries(db, clock.now(), cutoff);
  logger.info({ expired }, 'waitlist.expired');

  let promoted = 0;
  for (const classId of await findClassesNeedingPromotion(db, clock.now(), cutoff)) {
    try {
      const promotions = await db
        .transaction()
        .execute((trx) => promoteNext(trx, classId, { clock, config, logger, paymentsEnabled }));
      promoted += promotions.length;
      await notifyPromotions(promotions, notifier, logger);
    } catch (error) {
      logger.error(
        { classId, error: error instanceof Error ? error.message : String(error) },
        'waitlist.sweep_failed',
      );
    }
  }
  return { expired, promoted };
}
