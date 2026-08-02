import React from 'react';

/** Stable FNV-1a hash so a title always maps to the same hue. */
function hashHue(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

interface TypographicCoverProps {
  title: string;
  author?: string | null;
}

/**
 * A generated, typographic book cover for items without cover art — a warm
 * low-chroma color block (hue derived from the title) with the serif title
 * top-left and an uppercase author/series line bottom. Matches the Flutter app's
 * cover-less fallback and the Folio grid covers. Fills its parent.
 */
export default function TypographicCover({ title, author }: TypographicCoverProps) {
  const hue = hashHue(title);
  const bg = `hsl(${hue} 22% 16%)`;
  const titleTint = `hsl(${hue} 24% 82%)`;
  const authorTint = `hsl(${hue} 20% 58%)`;
  const label = (author ?? '').trim();

  return (
    <div
      className="flex h-full w-full flex-col justify-between p-[10%]"
      style={{ backgroundColor: bg }}
    >
      <div
        className="font-serif text-[15px] leading-[1.25] line-clamp-4"
        style={{ color: titleTint }}
      >
        {title}
      </div>
      {label && (
        <div
          className="truncate font-sans text-[8px] uppercase tracking-[0.1em]"
          style={{ color: authorTint }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
