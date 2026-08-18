/**
 * @module
 * Aspect-Ratio Preserving Scale Math
 *
 * Architecture overview for Junior Devs:
 * The comic reader needs to show a page as large as possible without distorting
 * it or letting it spill outside the visible area. This module does that one
 * piece of geometry: given the image size and the viewport size, it returns the
 * largest size that keeps the original proportions and still fits.
 *
 * It is pure math (no DOM, no Node), which is why it lives in `src/shared/` and
 * has its own unit tests.
 */

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Calculate display dimensions that fit within a viewport without stretching.
 *
 * Compares the image and viewport aspect ratios to decide whether width
 * or height is the limiting dimension. Any non-positive input returns a zero size
 * so callers don't have to guard against divide-by-zero.
 *
 * @param imageWidth Original image width, in pixels.
 * @param imageHeight Original image height, in pixels.
 * @param viewportWidth Available width, in pixels.
 * @param viewportHeight Available height, in pixels.
 * @returns The scaled `{ width, height }` that fits inside the viewport.
 */
export function scaleToFit(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number
): Dimensions {
  if (imageWidth <= 0 || imageHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { width: 0, height: 0 };
  }

  const imageAspect = imageWidth / imageHeight;
  const viewportAspect = viewportWidth / viewportHeight;

  let displayWidth: number;
  let displayHeight: number;

  if (imageAspect > viewportAspect) {
    // Image is wider than viewport - constrain by width
    displayWidth = viewportWidth;
    displayHeight = viewportWidth / imageAspect;
  } else {
    // Image is taller than viewport - constrain by height
    displayHeight = viewportHeight;
    displayWidth = viewportHeight * imageAspect;
  }

  return {
    width: displayWidth,
    height: displayHeight,
  };
}
