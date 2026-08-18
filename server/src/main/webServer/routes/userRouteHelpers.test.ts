import { describe, expect, it } from 'vitest';
import {
  deleteUserBlockReason,
  normalizeAdminFlag,
  setRoleBlockReason,
} from './userRouteHelpers';

describe('userRouteHelpers', () => {
  it('normalizes admin role requests to true only for literal true', () => {
    expect(normalizeAdminFlag(true)).toBe(true);
    expect(normalizeAdminFlag(false)).toBe(false);
    expect(normalizeAdminFlag('true')).toBe(false);
    expect(normalizeAdminFlag(undefined)).toBe(false);
  });

  it('blocks deleting yourself before other delete checks', () => {
    expect(deleteUserBlockReason(3, 3, null, 1)).toEqual({
      blocked: true,
      status: 400,
      message: 'Cannot delete yourself',
    });
  });

  it('blocks deleting missing users and the last admin', () => {
    expect(deleteUserBlockReason(1, 3, null, 2)).toEqual({
      blocked: true,
      status: 404,
      message: 'User not found',
    });
    expect(deleteUserBlockReason(1, 3, { id: 3, isAdmin: true }, 1)).toEqual({
      blocked: true,
      status: 400,
      message: 'Cannot delete last admin',
    });
  });

  it('allows deleting a non-self user when it does not remove the last admin', () => {
    expect(deleteUserBlockReason(1, 3, { id: 3, isAdmin: false }, 1)).toEqual({ blocked: false });
    expect(deleteUserBlockReason(1, 3, { id: 3, isAdmin: true }, 2)).toEqual({ blocked: false });
  });

  it('blocks role changes for missing users and last-admin demotions', () => {
    expect(setRoleBlockReason(null, false, 2)).toEqual({
      blocked: true,
      status: 404,
      message: 'User not found',
    });
    expect(setRoleBlockReason({ id: 3, isAdmin: true }, false, 1)).toEqual({
      blocked: true,
      status: 400,
      message: 'Cannot demote last admin',
    });
  });

  it('allows safe role changes', () => {
    expect(setRoleBlockReason({ id: 3, isAdmin: true }, false, 2)).toEqual({ blocked: false });
    expect(setRoleBlockReason({ id: 3, isAdmin: false }, true, 1)).toEqual({ blocked: false });
  });
});
