/**
 * PDF canvas memory policy: how many painted pages to keep, and how to release
 * pixel buffers when a page leaves the overscan window.
 *
 * iPadOS is the painful case — a few DPR-scaled color pages are tens of MB each.
 */

export type DeviceClass = "phone" | "tablet" | "desktop";

export interface PdfMemoryBudget {
  deviceClass: DeviceClass;
  /** Max simultaneously painted scroll-mode canvases. */
  maxPaintedPages: number;
  /** Overscan pages beyond the viewport to keep painted. */
  overscan: number;
}

/**
 * Classify the device from viewport CSS width (matches our adaptive layouts).
 */
export function classifyDevice(
  cssWidth: number = typeof window !== "undefined" ? window.innerWidth : 1024,
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): DeviceClass {
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  if (cssWidth >= 900) return "desktop";
  if (cssWidth >= 600) return "tablet";
  return "phone";
}

export function pdfMemoryBudget(
  cssWidth?: number,
  ua?: string,
): PdfMemoryBudget {
  const deviceClass = classifyDevice(cssWidth, ua);
  switch (deviceClass) {
    case "phone":
      return { deviceClass, maxPaintedPages: 6, overscan: 2 };
    case "tablet":
      // Stricter: retina tablets blow through RAM fastest.
      return { deviceClass, maxPaintedPages: 5, overscan: 1 };
    default:
      return { deviceClass, maxPaintedPages: 12, overscan: 3 };
  }
}

/**
 * Release a canvas backing store so the browser can reclaim pixel memory.
 * Also clears paint markers used by PdfReader.
 */
export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  try {
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  } catch {
    /* ignore */
  }
  canvas.width = 0;
  canvas.height = 0;
  canvas.style.width = "0";
  canvas.style.height = "0";
  delete canvas.dataset.painted;
  delete canvas.dataset.w;
}

/**
 * Given currently painted page indices and the desired keep-set (visible +
 * overscan), return indices whose canvas buffers should be released. Also
 * enforces `maxPainted` by dropping furthest-from-focus pages first.
 */
export function pagesToRelease(
  painted: Iterable<number>,
  keep: Set<number>,
  maxPainted: number,
  /** Prefer keeping pages closest to `focus` when over budget. */
  focus: number,
): number[] {
  const paintedList = [...painted];
  const drop: number[] = [];
  for (const i of paintedList) {
    if (!keep.has(i)) drop.push(i);
  }
  // Still over budget: drop furthest from focus among remaining.
  let kept = paintedList.filter((i) => !drop.includes(i));
  if (kept.length > maxPainted) {
    kept = kept.sort((a, b) => Math.abs(a - focus) - Math.abs(b - focus));
    for (const i of kept.slice(maxPainted)) {
      drop.push(i);
    }
  }
  return drop;
}

/**
 * Build the keep-set from a virtual window [start, end).
 */
export function keepSetFromWindow(start: number, end: number): Set<number> {
  const s = new Set<number>();
  for (let i = start; i < end; i++) s.add(i);
  return s;
}
