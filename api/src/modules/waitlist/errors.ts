import { DomainError } from '../../shared/errors.js';

export const WAITLIST_MESSAGES = {
  classNotFound: 'This class does not exist.',
  entryNotFound: 'This waiting-list place does not exist.',
  classNotBookable: 'This class can no longer be booked.',
  waitlistClosed: 'The waiting list for this class is closed.',
  alreadyBooked: 'You have already booked this class.',
  alreadyOnWaitlist: 'You are already on the waiting list for this class.',
  classNotFull: 'This class has free places – book directly.',
  entryNotActive: 'You are no longer on this waiting list.',
  onlyMembers: 'Only members can join waiting lists.',
} as const;

export const classNotFound = (): DomainError =>
  new DomainError('CLASS_NOT_FOUND', WAITLIST_MESSAGES.classNotFound, 404);

export const waitlistEntryNotFound = (): DomainError =>
  new DomainError('WAITLIST_ENTRY_NOT_FOUND', WAITLIST_MESSAGES.entryNotFound, 404);

export const classNotBookable = (): DomainError =>
  new DomainError('CLASS_NOT_BOOKABLE', WAITLIST_MESSAGES.classNotBookable, 409);

export const waitlistClosed = (): DomainError =>
  new DomainError('WAITLIST_CLOSED', WAITLIST_MESSAGES.waitlistClosed, 409);

export const alreadyBooked = (): DomainError =>
  new DomainError('ALREADY_BOOKED', WAITLIST_MESSAGES.alreadyBooked, 409);

export const alreadyOnWaitlist = (): DomainError =>
  new DomainError('ALREADY_ON_WAITLIST', WAITLIST_MESSAGES.alreadyOnWaitlist, 409);

export const classNotFull = (): DomainError =>
  new DomainError('CLASS_NOT_FULL', WAITLIST_MESSAGES.classNotFull, 409);

export const waitlistEntryNotActive = (): DomainError =>
  new DomainError('WAITLIST_ENTRY_NOT_ACTIVE', WAITLIST_MESSAGES.entryNotActive, 409);
