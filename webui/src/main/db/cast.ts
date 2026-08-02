/**
 * @module
 * Row-Type Casting Helpers for node:sqlite
 *
 * Architecture overview for Junior Devs:
 * `node:sqlite` hands back query results as a generic `Record<string, ...>`, not
 * the specific row shape we want (like `ComicRow`). TypeScript refuses a direct
 * `value as ComicRow` because the two types don't overlap (error TS2352). The
 * approved escape hatch is to cast through `unknown`. These two one-liners do
 * exactly that in one place so the `as unknown as T` pattern isn't scattered
 * around the codebase.
 */

/**
 * Cast a single row from `StatementSync.get()` to a known shape.
 * @param val The raw row (or `undefined`).
 * @returns The same value typed as `T`. No runtime validation is performed.
 */
export function asRow<T>(val: unknown): T {
  return val as unknown as T;
}

/**
 * Cast an array of rows from `StatementSync.all()` to a known shape.
 * @param val The raw rows array.
 * @returns The same value typed as `T[]`. No runtime validation is performed.
 */
export function asRows<T>(val: unknown): T[] {
  return val as unknown as T[];
}
