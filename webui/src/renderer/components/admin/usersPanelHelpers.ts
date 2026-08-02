/**
 * @module
 * User-Management Panel Logic Helpers
 *
 * Architecture overview for Junior Devs:
 * The admin user-management panel creates users and toggles their admin role.
 * This module holds the small pure rules behind those actions: validating the
 * new-user form, flipping the admin flag, and detecting when an admin is acting on
 * their own account (used to prevent self-lockout in the UI). Keeping them
 * separate from the component makes the rules easy to unit test.
 */

/** A validated new-user payload. */
export interface CreateUserInput {
  username: string;
  password: string;
}

/** Result of validating the create-user form: cleaned input, or an error message. */
export type CreateUserValidation =
  | { ok: true; input: CreateUserInput }
  | { ok: false; message: string };

/**
 * Validate the create-user form fields.
 * Requires a non-blank username (trimmed) and a non-empty password.
 * @param username The raw username input.
 * @param password The raw password input.
 * @returns A tagged result with cleaned input on success, or an error message.
 */
export function validateCreateUser(username: string, password: string): CreateUserValidation {
  const trimmed = username.trim();
  if (!trimmed || !password) {
    return { ok: false, message: 'Please enter both username and password.' };
  }
  return { ok: true, input: { username: trimmed, password } };
}

/**
 * Compute the toggled admin-role value.
 * @param currentValue The user's current admin flag.
 * @returns The negated flag.
 */
export function nextAdminRole(currentValue: boolean): boolean {
  return !currentValue;
}

/**
 * Whether a target user is the currently signed-in user.
 * Used to guard against an admin changing/removing their own access.
 * @param sessionUserId The signed-in user's id, if any.
 * @param targetUserId The id of the user being acted on.
 * @returns `true` if they are the same user.
 */
export function isSelfUser(sessionUserId: number | null | undefined, targetUserId: number): boolean {
  return sessionUserId === targetUserId;
}
