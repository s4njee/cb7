/**
 * @module
 * User-Management Route Guard Helpers
 *
 * Architecture overview for Junior Devs:
 * The user-management routes (delete a user, change an admin role) carry a real
 * risk: an admin could lock everyone out by deleting or demoting the last
 * remaining admin, or by acting on their own account. This module holds the pure
 * guard rules that decide whether such a mutation is allowed *before* the route
 * touches the database.
 *
 * Each guard returns a `UserMutationBlock`: either `{ blocked: false }` (proceed)
 * or `{ blocked: true, status, message }` (the route should reply with that HTTP
 * status and message). Encoding the decision as data — rather than throwing —
 * keeps the rules pure and unit-testable, and lets the handler stay a thin
 * "check, then act" shell. `normalizeAdminFlag` is the small input gate that
 * coerces an untrusted body value into a strict boolean.
 */

/** The subset of a user record the route guards need. */
export interface UserRouteRecord {
  id: number;
  isAdmin: boolean;
}

/** Whether a user mutation may proceed, or why it is blocked. */
export type UserMutationBlock =
  | { blocked: true; status: number; message: string }
  | { blocked: false };

/**
 * Coerce an untrusted value into a strict admin boolean.
 * @param value The raw value from the request body.
 * @returns `true` only when the value is exactly the boolean `true`.
 */
export function normalizeAdminFlag(value: unknown): boolean {
  return value === true;
}

/**
 * Decide whether a user-deletion may proceed.
 * Blocks deleting yourself, deleting a missing user, and deleting the
 *          last remaining admin.
 * @param currentUserId The signed-in user's id, if any.
 * @param targetUserId The id of the user being deleted.
 * @param target The target user's record, or `null` if not found.
 * @param adminCount The current number of admins.
 * @returns A block descriptor: proceed, or the status/message to return.
 */
export function deleteUserBlockReason(
  currentUserId: number | null | undefined,
  targetUserId: number,
  target: UserRouteRecord | null,
  adminCount: number
): UserMutationBlock {
  if (currentUserId === targetUserId) {
    return { blocked: true, status: 400, message: 'Cannot delete yourself' };
  }
  if (!target) {
    return { blocked: true, status: 404, message: 'User not found' };
  }
  if (target.isAdmin && adminCount <= 1) {
    return { blocked: true, status: 400, message: 'Cannot delete last admin' };
  }
  return { blocked: false };
}

/**
 * Decide whether an admin-role change may proceed.
 * Blocks acting on a missing user and demoting the last remaining admin.
 * @param target The target user's record, or `null` if not found.
 * @param nextIsAdmin The desired admin flag after the change.
 * @param adminCount The current number of admins.
 * @returns A block descriptor: proceed, or the status/message to return.
 */
export function setRoleBlockReason(
  target: UserRouteRecord | null,
  nextIsAdmin: boolean,
  adminCount: number
): UserMutationBlock {
  if (!target) {
    return { blocked: true, status: 404, message: 'User not found' };
  }
  if (target.isAdmin && !nextIsAdmin && adminCount <= 1) {
    return { blocked: true, status: 400, message: 'Cannot demote last admin' };
  }
  return { blocked: false };
}
