import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { VERSION } from '../src/version.ts';

describe('toolchain', () => {
  it('runs TypeScript and has node:sqlite available', () => {
    const db = new DatabaseSync(':memory:');
    const row = db.prepare('select 1 as one').get() as { one: number };
    expect(row.one).toBe(1);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
