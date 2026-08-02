import { describe, expect, it } from 'vitest';
import { isSelfUser, nextAdminRole, validateCreateUser } from './usersPanelHelpers';

describe('usersPanelHelpers', () => {
  it('validates and trims new user input', () => {
    expect(validateCreateUser('  sam  ', 'secret')).toEqual({
      ok: true,
      input: { username: 'sam', password: 'secret' },
    });
  });

  it('requires both username and password', () => {
    expect(validateCreateUser('sam', '')).toEqual({
      ok: false,
      message: 'Please enter both username and password.',
    });
    expect(validateCreateUser('   ', 'secret')).toEqual({
      ok: false,
      message: 'Please enter both username and password.',
    });
  });

  it('toggles the admin role value explicitly', () => {
    expect(nextAdminRole(false)).toBe(true);
    expect(nextAdminRole(true)).toBe(false);
  });

  it('detects the current user', () => {
    expect(isSelfUser(4, 4)).toBe(true);
    expect(isSelfUser(null, 4)).toBe(false);
    expect(isSelfUser(7, 4)).toBe(false);
  });
});
