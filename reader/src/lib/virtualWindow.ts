/**
 * Virtual window math for long scroll surfaces and thumbnail strips.
 *
 * Renders only indices in [start, end) with a small overscan so 1,000+ page
 * comics/PDFs do not mount a React node per page. Spacers preserve scroll
 * height so anchors stay stable when the window slides.
 */

export interface VirtualWindow {
  /** First index to mount (inclusive). */
  start: number;
  /** One past last index to mount. */
  end: number;
  /** Spacer height (or width for horizontal strips) before the window. */
  beforePx: number;
  /** Spacer after the window. */
  afterPx: number;
}

export interface VirtualWindowInput {
  total: number;
  /** Scroll offset of the viewport (px). */
  scrollOffset: number;
  /** Viewport size along the scroll axis (px). */
  viewportSize: number;
  /** Fixed size per item along the scroll axis (px). */
  itemSize: number;
  /** Extra items to mount past the visible range. Default 4. */
  overscan?: number;
  /** Gap between items (px), included in stride. Default 0. */
  gap?: number;
}

/**
 * Compute a measured window for fixed-size items in a scroll container.
 */
export function computeVirtualWindow(input: VirtualWindowInput): VirtualWindow {
  const {
    total,
    scrollOffset,
    viewportSize,
    itemSize,
    overscan = 4,
    gap = 0,
  } = input;

  if (total <= 0 || itemSize <= 0) {
    return { start: 0, end: 0, beforePx: 0, afterPx: 0 };
  }

  const stride = itemSize + gap;
  const firstVisible = Math.floor(Math.max(0, scrollOffset) / stride);
  const visibleCount = Math.ceil(viewportSize / stride) + 1;
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(total, firstVisible + visibleCount + overscan);
  const beforePx = start * stride;
  const afterPx = Math.max(0, (total - end) * stride);
  // When gap is non-zero, afterPx includes gaps between unmounted items; the
  // final trailing gap after the last item is not part of the scroll height in
  // flex layouts with gap, but overestimating slightly is safer than under.
  return { start, end, beforePx, afterPx };
}

/**
 * Indices to mount from a virtual window.
 */
export function windowIndices(win: VirtualWindow): number[] {
  const out: number[] = [];
  for (let i = win.start; i < win.end; i++) out.push(i);
  return out;
}

/**
 * Find the page index whose slot starts at or after `scrollOffset` with a
 * 40% threshold — same rule the PDF reader used when scanning all slots.
 */
export function pageAtScroll(
  scrollOffset: number,
  itemSize: number,
  gap: number,
  total: number,
): number {
  if (total <= 0 || itemSize <= 0) return 0;
  const stride = itemSize + gap;
  // Slot center-ish: treat page as current when 40% of its height has scrolled.
  const idx = Math.floor((scrollOffset + itemSize * 0.4) / stride);
  return Math.max(0, Math.min(total - 1, idx));
}

/** Thumbnail strip: fixed 26×39 thumbs with 7px gap (see app.css). */
export const THUMB_WIDTH = 26;
export const THUMB_GAP = 7;
export const THUMB_STRIDE = THUMB_WIDTH + THUMB_GAP;

/** Comic continuous mode: ~460×690 portrait estimate (2/3 of 460). */
export const COMIC_SCROLL_EST_WIDTH = 460;
export const COMIC_SCROLL_EST_HEIGHT = Math.round(460 * 1.5);
export const COMIC_SCROLL_GAP = 14;

/** PDF continuous mode: width-driven, ~1.3 aspect placeholder (PdfReader). */
export function pdfScrollEstHeight(containerWidth: number): number {
  return Math.max(120, Math.round(containerWidth * 1.3));
}

export const PDF_SCROLL_GAP = 16;
