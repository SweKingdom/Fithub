import type { Generated, Insertable, Selectable } from 'kysely';

/** Row type of `gym_class` (migration 0003). Registered in `Database` (`api/src/db/schema.ts`). */
export interface GymClassTable {
  id: Generated<string>;
  club_id: string;
  name: string;
  start_at: Date;
  duration_minutes: number;
  capacity: number;
  status: Generated<'scheduled' | 'cancelled'>;
  instructor_id: string | null;
  created_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type NewGymClass = Insertable<GymClassTable>;
export type GymClassRow = Selectable<GymClassTable>;
