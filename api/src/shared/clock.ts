/** Source of the current time. Injected so tests can fix or move time. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
