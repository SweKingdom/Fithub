import { describe, expect, it } from 'vitest';
import { assertTestDatabase } from '../helpers/db.js';

describe('assertTestDatabase', () => {
  it('refuses a database whose name does not end in _test', () => {
    expect(() => assertTestDatabase('postgres://u:p@h:5432/fithub')).toThrow(
      'Refusing to run integration tests against non-test database "fithub"',
    );
  });

  it('accepts a database whose name ends in _test', () => {
    expect(() => assertTestDatabase('postgres://u:p@h:5432/fithub_test')).not.toThrow();
  });

  it('ignores the query string', () => {
    expect(() =>
      assertTestDatabase('postgres://u:p@h:5432/fithub_test?sslmode=disable'),
    ).not.toThrow();
  });

  it('refuses an unparsable URL', () => {
    expect(() => assertTestDatabase('not a url')).toThrow(/Refusing to run integration tests/);
  });
});
