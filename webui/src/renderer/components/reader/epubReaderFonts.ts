import type { EpubPrefs } from '@/store/readerStore';

function googleFontHref(name: string): string {
  return `https://fonts.googleapis.com/css2?family=${name.trim().replace(/ /g, '+')}&display=swap`;
}

export function fontFamilyForPrefs(prefs: EpubPrefs): string {
  return prefs.googleFont ? `'${prefs.googleFont}', serif` : prefs.fontFamily;
}

export function injectGoogleFont(doc: Document, name: string): void {
  if (!doc || !name) return;
  const existing = doc.getElementById('cb8-google-font');
  if (existing instanceof HTMLElement) {
    if (existing.dataset.font === name) return;
    existing.remove();
  }
  const link = doc.createElement('link');
  link.id = 'cb8-google-font';
  link.rel = 'stylesheet';
  link.href = googleFontHref(name);
  link.dataset.font = name;
  (doc.head || doc.documentElement)?.appendChild(link);
}

export function preloadGoogleFont(name: string): void {
  if (!name) return;
  const id = 'cb8-gf-preload';
  const existing = document.getElementById(id);
  if (existing instanceof HTMLElement && existing.dataset.font === name) return;
  existing?.remove();

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = googleFontHref(name);
  link.dataset.font = name;
  document.head.appendChild(link);
}
