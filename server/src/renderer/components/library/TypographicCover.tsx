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
  mediaType?: 'comic' | 'book';
}

/**
 * A generated, typographic book cover for items without cover art — a warm
 * low-chroma color block (hue derived from the title) with the serif title
 * top-left and an uppercase author/series line bottom. Matches the Flutter app's
 * cover-less fallback and the Folio grid covers. Fills its parent.
 */
export default function TypographicCover({ title, author, mediaType = 'comic' }: TypographicCoverProps) {
  const hue = hashHue(title);
  const bg = `linear-gradient(135deg, hsl(${hue} 22% 18%), hsl(${(hue + 28) % 360} 24% 11%))`;
  const titleTint = `hsl(${hue} 24% 82%)`;
  const authorTint = `hsl(${hue} 20% 58%)`;
  const label = (author ?? '').trim();

  return (
    <div
      className="typographic-cover flex h-full w-full flex-col justify-start p-[10%] [container-type:inline-size]"
      style={{ background: bg }}
    >
      <div
        className="border-b pb-2 text-[8px] font-semibold uppercase tracking-[0.14em] opacity-80"
        style={{ borderColor: `hsl(${hue} 24% 62% / 0.42)`, color: titleTint }}
      >
        {mediaType === 'book' ? 'Book' : 'Comic'}
      </div>
      <div
        className="mt-2 font-serif text-[clamp(14px,10cqw,18px)] font-semibold leading-[1.15] line-clamp-4"
        style={{ color: titleTint }}
      >
        {title}
      </div>
      {label && (
        <div
          className="mt-auto truncate font-sans text-[8px] uppercase tracking-[0.1em] opacity-80"
          style={{ color: authorTint }}
        >
          {label}
        </div>
      )}
    </div>
  );
}
