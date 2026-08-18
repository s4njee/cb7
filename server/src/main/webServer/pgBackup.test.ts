import { describe, expect, it } from 'vitest';
import { pgDumpArgs } from './pgBackup';

describe('pgDumpArgs', () => {
  it('uses portable, drop-then-recreate flags with the connection URI as the db', () => {
    expect(pgDumpArgs('postgres://user:pass@host:5432/cb8')).toEqual([
      '--no-owner',
      '--clean',
      '--if-exists',
      'postgres://user:pass@host:5432/cb8',
    ]);
  });
});
