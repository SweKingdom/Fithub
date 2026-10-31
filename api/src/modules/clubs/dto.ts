import { z } from 'zod';
import type { ClubRow } from './db-types.js';

/** The public shape of a club. No other column is ever returned. */
export const ClubDtoSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  timezone: z.string(),
});

export type ClubDto = z.infer<typeof ClubDtoSchema>;

export function toClubDto(row: ClubRow): ClubDto {
  return { id: row.id, code: row.code, name: row.name, timezone: row.timezone };
}
