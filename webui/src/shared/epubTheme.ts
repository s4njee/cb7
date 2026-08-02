export interface FontFamily {
  label: string;
  value: string;
}

export const FONT_FAMILIES: FontFamily[] = [
  { label: 'Serif', value: 'Newsreader, Georgia, "Times New Roman", serif' },
  { label: 'Sans', value: '"Instrument Sans", Arial, Helvetica, sans-serif' },
  { label: 'System', value: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { label: 'Mono', value: '"SFMono-Regular", Consolas, "Liberation Mono", monospace' },
];

export const FONT_SIZES = [70, 80, 90, 100, 110, 120, 130];
export const EPUB_BASE_FONT_SCALE = 0.85;

// The three reading themes, matching the Flutter "Hearth Noir" reader:
//  black  → true-black warm page, warm off-white text
//  white  → warm off-white page
//  sepia  → warm paper tone
export type ThemeMode = 'black' | 'white' | 'sepia';

export interface ThemeColors {
  background: string;
  text: string;
  link: string;
}

export function getThemeColors(mode: ThemeMode): ThemeColors {
  switch (mode) {
    case 'white':
      return { background: '#f4efe4', text: '#2b2620', link: '#9a4a38' };
    case 'sepia':
      return { background: '#e8dcc2', text: '#4a3d28', link: '#8a5320' };
    case 'black':
    default:
      return { background: '#0d0b0a', text: '#ddd4c3', link: '#e08a6f' };
  }
}

export const EPUB_FONT_SIZE_STYLE_ID = 'cb8-epub-font-size';

const EPUB_TEXT_INHERIT_SELECTOR = [
  'p', 'div', 'span', 'section', 'article', 'aside', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'a', 'em', 'strong', 'i', 'b',
].join(', ');

export function buildEpubTheme(mode: ThemeMode, fontFamily: string, fontSize = 100) {
  const colors = getThemeColors(mode);
  const hPad = '2.75rem';
  const fontSizeCss = toEpubFontSizePercent(fontSize);
  const textRule = {
    color: `${colors.text} !important`,
    'background-color': 'transparent !important',
  };
  return {
    html: {
      background: `${colors.background} !important`,
      'background-color': `${colors.background} !important`,
      'font-size': `${fontSizeCss} !important`,
    },
    body: {
      background: `${colors.background} !important`,
      'background-color': `${colors.background} !important`,
      color: `${colors.text} !important`,
      'font-family': fontFamily,
      'font-size': '100% !important',
      'line-height': '1.6',
      margin: '0',
      padding: `2rem ${hPad}`,
      'box-sizing': 'border-box',
    },
    'body *': textRule,
    [EPUB_TEXT_INHERIT_SELECTOR]: {
      ...textRule,
      'font-size': 'inherit !important',
    },
    a: {
      color: `${colors.link} !important`,
      'background-color': 'transparent !important',
    },
    img: {
      'max-width': '100%',
      'max-height': '100%',
    },
    p: {
      'margin-top': '0',
      'margin-bottom': '1em',
    },
  };
}

export function toEpubFontSizePercent(fontSize: number): string {
  return `${Math.round(fontSize * EPUB_BASE_FONT_SCALE)}%`;
}

export function buildEpubFontSizeCss(fontSize: number): string {
  const pct = toEpubFontSizePercent(fontSize);
  return [
    `html { font-size: ${pct} !important; }`,
    `body { font-size: 100% !important; }`,
    `${EPUB_TEXT_INHERIT_SELECTOR} { font-size: inherit !important; }`,
  ].join('\n');
}

export function applyEpubFontSizeToDocument(doc: Document, fontSize: number): void {
  const pct = toEpubFontSizePercent(fontSize);
  let styleEl = doc.getElementById(EPUB_FONT_SIZE_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = doc.createElement('style');
    styleEl.id = EPUB_FONT_SIZE_STYLE_ID;
    doc.head.appendChild(styleEl);
  }
  styleEl.textContent = buildEpubFontSizeCss(fontSize);
  // Keep our override last in the cascade when epub.js appends theme rules.
  doc.head.appendChild(styleEl);

  doc.documentElement.style.setProperty('font-size', pct, 'important');
  doc.body?.style.setProperty('font-size', '100%', 'important');

  const styled = doc.querySelectorAll<HTMLElement>('[style*="font-size"], [style*="fontSize"]');
  for (let i = 0; i < styled.length; i++) {
    styled[i].style.removeProperty('font-size');
  }
}

export function forceThemeOnContent(
  contents: { document?: Document } | null | undefined,
  mode: ThemeMode,
  fontFamily?: string,
  fontSize?: number,
): void {
  const colors = getThemeColors(mode);
  const doc = contents?.document;
  if (!doc) return;
  if (fontSize !== undefined) {
    applyEpubFontSizeToDocument(doc, fontSize);
  }
  const body = doc.body;
  if (body) {
    body.style.setProperty('background-color', colors.background, 'important');
    if (fontFamily) body.style.setProperty('font-family', fontFamily, 'important');
  }
  doc.documentElement?.style.setProperty('background-color', colors.background, 'important');
  const elements = doc.querySelectorAll('*');
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i] as HTMLElement;
    const tag = el.tagName;
    if (tag === 'IMG' || tag === 'SVG' || tag === 'PICTURE' || tag === 'VIDEO') continue;
    el.style.setProperty('color', colors.text, 'important');
    el.style.setProperty('background-color', 'transparent', 'important');
    if (fontFamily) el.style.setProperty('font-family', fontFamily, 'important');
  }
}
