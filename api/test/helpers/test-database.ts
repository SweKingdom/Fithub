/** Integration tests wipe and fill tables: they only ever run against a database whose name ends in `_test` (ADR-017). */
export function assertTestDatabase(url: string): void {
  let name: string;
  try {
    name = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('The test database URL is not a valid URL.');
  }
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests on database "${name}": its name must end with "_test".`);
  }
}
