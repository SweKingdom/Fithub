import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const DATABASE_URL = 'postgres://u:p@localhost:5432/db';

describe('loadConfig', () => {
  it('applies defaults for optional variables', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      DATABASE_URL,
      PORT: 3000,
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
    });
  });

  it('reads provided values', () => {
    const config = loadConfig({ DATABASE_URL, PORT: '8080', NODE_ENV: 'test', LOG_LEVEL: 'warn' });
    expect(config).toMatchObject({ PORT: 8080, NODE_ENV: 'test', LOG_LEVEL: 'warn' });
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadConfig({})).toThrow(/^Invalid configuration: DATABASE_URL/);
  });

  it('throws when PORT is not a number', () => {
    expect(() => loadConfig({ DATABASE_URL, PORT: 'abc' })).toThrow(
      /^Invalid configuration: PORT/,
    );
  });

  it('throws when PORT is out of range', () => {
    expect(() => loadConfig({ DATABASE_URL, PORT: '70000' })).toThrow(
      /^Invalid configuration: PORT/,
    );
  });
});
