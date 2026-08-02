/** When a page transition deserves a haptic tick, and which one.
 *
 *  Split out of `Reader.tsx` because this is the whole feature: the plumbing
 *  either buzzes or it doesn't, but *these rules* decide whether the app feels
 *  considered or feels broken — and they cannot be checked by running the app,
 *  since a simulator has no taptic engine and a buzz leaves no trace. So they
 *  live here, pure and covered by vectors.
 */
import type { HapticKind } from "./transport";

export interface TurnState {
  /** 1-based page/location, or null while the reader is still starting up. */
  page: number | null;
  /** Key of the active chapter, or null when the format has no chapters. */
  chapter: string | null;
}

export interface TurnContext {
  /** The reader's haptics preference. */
  enabled: boolean;
  /** Whether the surface paginates. Webtoon and scrolled flow move the page
   *  number continuously as the thumb drags, so they never tick. */
  paged: boolean;
}

/**
 * The tick for a transition, or `null` for silence.
 *
 * @param prev The last state we considered.
 * @param next The state now.
 * @param ctx Preference + surface.
 * @returns The kind of tick to fire, or null.
 */
export function hapticForTurn(
  prev: TurnState,
  next: TurnState,
  ctx: TurnContext,
): HapticKind | null {
  if (!ctx.enabled || !ctx.paged) return null;
  // Still booting, or this is the book's first paint: opening a book is not a
  // page turn, and buzzing as a book appears would feel like an error.
  if (next.page == null || prev.page == null) return null;
  if (next.page === prev.page) return null;
  // Crossing a chapter supersedes the page tick rather than stacking two
  // buzzes into one mush: one event, one feeling — just a bigger one.
  //
  // Both sides must be known: an EPUB builds its chapter index after the first
  // paint, so `null -> "ch1"` is *data arriving*, not the reader crossing a
  // boundary. Ticking there would put a chapter bump in the middle of a
  // chapter — you cannot cross out of somewhere we never knew we were.
  const crossed =
    prev.chapter != null && next.chapter != null && next.chapter !== prev.chapter;
  return crossed ? "chapter" : "page";
}
