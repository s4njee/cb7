/** Minimal inline icons — the bookmark ribbon is the only real glyph;
 *  chevrons / × / search are text or CSS in the markup. */

export function RibbonIcon({ size = 15, fill = "currentColor" }: { size?: number; fill?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} aria-hidden="true">
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  );
}
