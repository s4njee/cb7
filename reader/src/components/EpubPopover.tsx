/** Positioning shell shared by the footnote, dictionary and highlight popovers.
 *
 *  Every one of these is triggered from inside the epub.js iframe, whose
 *  coordinates mean nothing to the host page. Callers map the tap into host
 *  viewport space first (see `anchorFromFrame`) and pass the result here; this
 *  component only decides which side of that point it fits on. */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** A point in host-page viewport coordinates. */
export interface PopoverAnchor {
  x: number;
  y: number;
}

/** Map a point from an iframe's coordinate space into the host viewport.
 *  `frameElement` is null when the frame is cross-origin — never the case for
 *  epub.js's blob-backed sections, but the DOM types allow it, so fall back to
 *  the raw point rather than dropping the interaction. */
export function anchorFromFrame(
  win: (Window & { frameElement?: Element | null }) | undefined,
  x: number,
  y: number,
): PopoverAnchor {
  const frame = win?.frameElement;
  if (!frame) return { x, y };
  const rect = frame.getBoundingClientRect();
  return { x: rect.left + x, y: rect.top + y };
}

const EDGE = 10;
const GAP = 12;

export default function EpubPopover({
  anchor,
  onClose,
  className = "",
  children,
}: {
  anchor: PopoverAnchor;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure before paint: the box is sized by its content, so its placement
  // can't be known until it exists. It stays invisible for that one frame
  // rather than flashing at the anchor and jumping.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const { width, height } = box.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = anchor.x - width / 2;
    left = Math.min(Math.max(left, EDGE), Math.max(EDGE, vw - width - EDGE));

    // Prefer above the tap — that's where the reader's finger isn't.
    let top = anchor.y - height - GAP;
    if (top < EDGE) {
      const below = anchor.y + GAP;
      top = below + height + EDGE > vh ? Math.max(EDGE, vh - height - EDGE) : below;
    }
    setPos({ left, top });
  }, [anchor.x, anchor.y]);

  return (
    <>
      <div className="epub-pop-backdrop" onPointerDown={onClose} />
      <div
        ref={boxRef}
        className={`epub-pop ${className}`}
        style={{
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          visibility: pos ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </>
  );
}
