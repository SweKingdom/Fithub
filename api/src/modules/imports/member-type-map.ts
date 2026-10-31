import { readFileSync } from 'node:fs';
import { ImportFileError } from './errors.js';
import { normalizeLookupKey } from './normalize.js';

export type MemberType = 'regular' | 'drop_in';

const MEMBER_TYPES: readonly string[] = ['regular', 'drop_in'];

/**
 * Loads the reviewed mapping `{ "<source value>": "regular" | "drop_in" }`.
 * Keys are compared with `normalizeLookupKey`. Any problem throws `ImportFileError`.
 */
export function loadMemberTypeMap(path: string): Map<string, MemberType> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ImportFileError(
        `Member type map not found: ${path}. Copy seed/member-type-map.example.json to seed/member-type-map.json and fill in the confirmed mapping.`,
      );
    }
    throw new ImportFileError(`Member type map cannot be read: ${path}.`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportFileError(`Member type map is not valid JSON: ${path}.`);
  }

  if (typeof json !== 'object' || json === null || Array.isArray(json) || Object.keys(json).length === 0) {
    throw new ImportFileError(`Member type map must be a non-empty JSON object: ${path}.`);
  }

  const map = new Map<string, MemberType>();
  for (const [source, target] of Object.entries(json)) {
    const key = normalizeLookupKey(source);
    if (key === '') {
      throw new ImportFileError('Member type map has an empty source value as a key.');
    }
    if (typeof target !== 'string' || !MEMBER_TYPES.includes(target)) {
      throw new ImportFileError(`Member type map value for "${source}" must be "regular" or "drop_in".`);
    }
    if (map.has(key)) {
      throw new ImportFileError(
        `Member type map has two keys that are equal after trimming and ignoring case: "${source}".`,
      );
    }
    map.set(key, target as MemberType);
  }
  return map;
}
