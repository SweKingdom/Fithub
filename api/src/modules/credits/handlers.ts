import type { CreditEventBus } from './events.js';
import { returnCreditForCancelledBooking, type CreditLogger } from './service.js';

/** Subscribes the credit return to `BookingCancelled`. It runs inside the cancel transaction (ADR-009). */
export function registerCreditHandlers(bus: CreditEventBus, deps: { logger: CreditLogger }): void {
  bus.subscribe('BookingCancelled', (event, trx) => returnCreditForCancelledBooking(trx, event, deps));
}
