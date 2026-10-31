import { z } from 'zod';

export const MAX_ENTRIES = 200;

export const classParamsSchema = z.object({ classId: z.string().uuid() });

const entrySchema = z
  .object({
    bookingId: z.string().uuid(),
    attendance: z.enum(['attended', 'no_show']),
  })
  .strict();

export const saveAttendanceBodySchema = z
  .object({ entries: z.array(entrySchema).min(1).max(MAX_ENTRIES) })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.entries.forEach((entry, index) => {
      if (seen.has(entry.bookingId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'bookingId'],
          message: 'Each booking can only appear once.',
        });
      }
      seen.add(entry.bookingId);
    });
  });

export type AttendanceEntry = z.infer<typeof entrySchema>;

export const attendanceRosterSchema = z.object({
  classId: z.string(),
  className: z.string(),
  startAt: z.string(),
  endsAt: z.string(),
  clubTimezone: z.string(),
  classStatus: z.enum(['scheduled', 'cancelled']),
  window: z.object({
    opensAt: z.string(),
    closesAt: z.string(),
    state: z.enum(['not_open', 'open', 'closed']),
  }),
  canEdit: z.boolean(),
  summary: z.object({
    booked: z.number(),
    attended: z.number(),
    noShows: z.number(),
    unknown: z.number(),
  }),
  items: z.array(
    z.object({
      bookingId: z.string(),
      memberId: z.string(),
      memberName: z.string(),
      attendance: z.enum(['unknown', 'attended', 'no_show']),
      recordedAt: z.string().nullable(),
      recordedByName: z.string().nullable(),
    }),
  ),
});

export type AttendanceRoster = z.infer<typeof attendanceRosterSchema>;

/** Started classes of the staff member's own club, newest first (entry point to the attendance list). */
export const startedClassesSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      startAt: z.string(),
      endsAt: z.string(),
      clubTimezone: z.string(),
    }),
  ),
});

export type StartedClasses = z.infer<typeof startedClassesSchema>;
