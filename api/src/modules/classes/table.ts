import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

/** Row type of `gym_class`. Register it in `Database` (`api/src/db/schema.ts`) as `gym_class`. */
export interface GymClassTable {
  id: Generated<string>;
  club_id: string;
  name: string;
  start_at: Date;
  duration_minutes: number;
  capacity: number;
  status: ColumnType<'scheduled' | 'cancelled', 'scheduled' | 'cancelled' | undefined, never>;
  instructor_id: string | null;
  created_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export type NewGymClass = Omit<Insertable<GymClassTable>, 'status'> & { status: 'scheduled' };
export type GymClassRow = Selectable<GymClassTable>;
