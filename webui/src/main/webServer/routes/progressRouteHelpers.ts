/**
 * @module
 * Reading-Progress Update Shaping Helpers
 *
 * Architecture overview for Junior Devs:
 * When the reader saves progress, the client sends a loosely-typed JSON body
 * (page, location, completed) that we can't trust. This module holds the pure
 * rules that turn that raw body into a clean, validated update before it touches
 * the database — and decides what, if anything, actually changed.
 *
 * The three exports answer three questions: `buildProgressUpdate` ("what's the
 * cleaned update?"), `hasProgressUpdate` ("is there anything to write?"), and
 * `progressMirrorUpdate` ("which single field should we mirror elsewhere, e.g.
 * to a synced device?"). Keeping these as pure functions lets the route handler
 * stay thin and lets the rules be unit tested in isolation. One small piece of
 * domain logic lives here too: reaching the final page auto-marks the item
 * completed unless the client said otherwise.
 */

/** The raw, untrusted progress fields as they arrive in the request body. */
export interface ProgressUpdateBody {
  page?: unknown;
  location?: unknown;
  percent?: unknown;
  completed?: unknown;
}

/** A cleaned, validated progress update ready to persist. */
export interface ProgressUpdateOptions {
  page?: number | null;
  location?: string | null;
  percent?: number | null;
  completed?: boolean;
}

/** The single progress field to mirror to other surfaces, or `none`. */
export type ProgressMirrorUpdate =
  | { kind: 'page'; page: number }
  | { kind: 'location'; location: string }
  | { kind: 'none' };

/**
 * Turn a raw request body into a validated progress update.
 * Copies through the pre-validated page, a string `location`, and a
 *          boolean `completed`. If a page is set, no explicit `completed` was
 *          given, and the page is the last one, marks the item completed.
 * @param body The untrusted request body.
 * @param validatedPage The already-validated page number, or `undefined` if none.
 * @param pageCount The item's total page count (used to detect the final page).
 * @returns The cleaned update options.
 */
export function buildProgressUpdate(
  body: ProgressUpdateBody,
  validatedPage: number | undefined,
  pageCount: number
): ProgressUpdateOptions {
  const opts: ProgressUpdateOptions = {};

  if (validatedPage !== undefined) {
    opts.page = validatedPage;
  }
  if (typeof body.location === 'string') {
    opts.location = body.location;
  }
  if (typeof body.percent === 'number' && Number.isFinite(body.percent)) {
    // Clamp to a 0-100 integer; this is whole-book progress for reflowable
    // formats (EPUB) and is display-only, so we never trust the raw client value.
    opts.percent = Math.max(0, Math.min(100, Math.round(body.percent)));
  }
  if (typeof body.completed === 'boolean') {
    opts.completed = body.completed;
  }
  if (typeof opts.page === 'number' && opts.completed === undefined && isFinalPage(opts.page, pageCount)) {
    opts.completed = true;
  }

  return opts;
}

/**
 * Whether an update carries any field worth writing.
 * @param opts The cleaned update options.
 * @returns `true` if page, location, or completed is set.
 */
export function hasProgressUpdate(opts: ProgressUpdateOptions): boolean {
  return opts.page !== undefined || opts.location !== undefined
    || opts.percent !== undefined || opts.completed !== undefined;
}

/**
 * Pick the single progress field to mirror elsewhere.
 * Prefers page over location; returns `none` when neither is present.
 * @param opts The cleaned update options.
 * @returns A tagged descriptor of the field to mirror.
 */
export function progressMirrorUpdate(opts: ProgressUpdateOptions): ProgressMirrorUpdate {
  if (typeof opts.page === 'number') {
    return { kind: 'page', page: opts.page };
  }
  if (typeof opts.location === 'string') {
    return { kind: 'location', location: opts.location };
  }
  return { kind: 'none' };
}

/**
 * Whether a 0-based page index is the item's last page.
 * @param page The 0-based page index.
 * @param pageCount The item's total page count.
 * @returns `true` when there are pages and `page` is the final one.
 */
function isFinalPage(page: number, pageCount: number): boolean {
  return pageCount > 0 && page >= pageCount - 1;
}
