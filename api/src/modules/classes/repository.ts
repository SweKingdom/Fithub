import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.js';
import type { ClassDtoRow } from './dto.js';
import type { NewGymClass } from './table.js';

/** Inserts one class and returns its id. */
export async function insertClass(db: Kysely<Database>, row: NewGymClass): Promise<string> {
  const inserted = await db
    .insertInto('gym_class')
    .values(row)
    .returning('id')
    .executeTakeFirstOrThrow();
  return inserted.id;
}

/** Reads a class with its instructor's full name; `undefined` when it does not exist. */
export async function findClassDtoRow(
  db: Kysely<Database>,
  id: string,
): Promise<ClassDtoRow | undefined> {
  return db
    .selectFrom('gym_class as c')
    .leftJoin('app_user as i', 'i.id', 'c.instructor_id')
    .select([
      'c.id',
      'c.club_id',
      'c.name',
      'c.start_at',
      'c.duration_minutes',
      'c.capacity',
      'c.status',
      'c.instructor_id',
      'i.full_name as instructor_name',
      'c.created_by',
      'c.created_at',
    ])
    .where('c.id', '=', id)
    .executeTakeFirst();
}
