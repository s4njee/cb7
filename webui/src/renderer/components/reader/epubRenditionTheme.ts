/**
 * @module
 * Live EPUB Rendition Theming Helpers
 *
 * Architecture overview for Junior Devs:
 * epub.js renders each chapter inside its own sandboxed <iframe>, so changing a
 * reader preference (like font size) means reaching into every live iframe
 * document and restyling it — there is no single page to update. This module
 * encapsulates that messy DOM-walking so the EpubReader component doesn't have
 * to know epub.js internals.
 *
 * The tricky part `forEachRenditionDocument` solves: epub.js's public
 * `getContents()` can miss the view that is mid-transition during a live update,
 * so we also walk the manager's internal view list and de-duplicate with a
 * WeakSet. `applyLiveEpubFontSize` then both restyles each document directly
 * (instant feedback) and updates the rendition theme + resizes (so re-rendered
 * chapters keep the new size). All the epub.js calls are wrapped in try/catch
 * because the internal shape is version-dependent and best-effort.
 */
import {
  applyEpubFontSizeToDocument,
  buildEpubTheme,
  forceThemeOnContent,
  getThemeColors,
  type ThemeMode,
  toEpubFontSizePercent,
} from '../../../shared/epubTheme';
import type { EpubRendition } from './EpubReaderTypes';

/** Minimal shape of an epub.js internal view (only the bits we read). */
export type EpubThemeView = {
  document?: Document;
  contents?: { document?: Document };
  iframe?: HTMLIFrameElement;
};

/** The user's EPUB reading preferences that affect theming. */
export interface EpubThemePrefs {
  themeMode: ThemeMode;
  fontSize: number;
  googleFont?: string;
}

/**
 * Inputs for a full theme application. `targetView` lets the caller force a
 * just-rendered view to be themed even before epub.js lists it. The two
 * callbacks are injectable so the component supplies real implementations and
 * tests can stub them.
 */
export interface ApplyEpubThemeOptions {
  rendition: EpubRendition;
  prefs: EpubThemePrefs;
  fontFamily: string;
  targetView?: EpubThemeView;
  injectGoogleFont?: (doc: Document, fontName: string) => void;
  forceContentTheme?: (
    contents: { document?: Document },
    mode: ThemeMode,
    fontFamily: string,
    fontSize: number
  ) => void;
}

/**
 * Visit every iframe document currently mounted by epub.js.
 * Combines `getContents()` with the manager's internal view list
 *          because `getContents()` alone can miss the active view during live
 *          preference updates. Each document is visited at most once.
 * @param rendition The epub.js rendition to walk.
 * @param visit Callback invoked once per unique live document.
 * @param extraViews Additional views to include (e.g. a just-rendered view epub.js
 *                   hasn't listed yet); de-duplicated against the rendition's own.
 */
export function forEachRenditionDocument(
  rendition: EpubRendition,
  visit: (doc: Document) => void,
  extraViews: EpubThemeView[] = [],
): void {
  const seen = new WeakSet<Document>();

  const add = (doc?: Document) => {
    if (!doc || seen.has(doc)) return;
    seen.add(doc);
    visit(doc);
  };

  for (const content of rendition.getContents?.() ?? []) {
    add(content.document);
  }

  const views = rendition.manager?.views?._views as EpubThemeView[] | undefined;
  for (const view of [...(views ?? []), ...extraViews]) {
    add(view.document);
    add(view.contents?.document);
    try {
      add(view.iframe?.contentDocument ?? view.iframe?.contentWindow?.document);
    } catch {}
  }
}

/**
 * Apply a font-size change to every live rendition document and refresh layout.
 * Restyles each mounted document for instant feedback, then overrides the
 *          rendition theme's font-size and resizes so re-rendered chapters keep the
 *          new size. epub.js calls are best-effort (wrapped in try/catch) because
 *          their internal API shape varies by version.
 * @param rendition The epub.js rendition to update.
 * @param fontSize The new font size (the app's numeric scale).
 */
export function applyLiveEpubFontSize(rendition: EpubRendition, fontSize: number): void {
  const fontSizeCss = toEpubFontSizePercent(fontSize);

  forEachRenditionDocument(rendition, (doc) => {
    applyEpubFontSizeToDocument(doc, fontSize);
  });

  try {
    rendition.themes.override('font-size', fontSizeCss, true);
  } catch {
    try {
      rendition.themes.fontSize(fontSizeCss);
    } catch {}
  }

  try {
    rendition.resize();
  } catch {}
}

/**
 * Apply the full theme (colours, font family, font size) to a rendition.
 * Sets the rendition's default theme, font, and font-size override, then
 *          walks every live document (plus any `targetView`) to inject the Google
 *          font and force the content theme. Finally paints each iframe's
 *          background so there's no flash of the wrong colour. Every epub.js call
 *          is best-effort (try/catch) because the internal API shape is
 *          version-dependent.
 * @param options The rendition, preferences, font family, optional target view,
 *                and injectable font/theme callbacks.
 */
export function applyEpubThemeToRendition({
  rendition,
  prefs,
  fontFamily,
  targetView,
  injectGoogleFont: injectFont,
  forceContentTheme = forceThemeOnContent,
}: ApplyEpubThemeOptions): void {
  const fontSizeCss = toEpubFontSizePercent(prefs.fontSize);

  try {
    rendition.themes.default(buildEpubTheme(prefs.themeMode, fontFamily, prefs.fontSize));
  } catch {}
  try {
    rendition.themes.font(fontFamily);
  } catch {}
  try {
    rendition.themes.override('font-size', fontSizeCss, true);
  } catch {}

  forEachRenditionDocument(
    rendition,
    (doc) => {
      try {
        if (prefs.googleFont) {
          injectFont?.(doc, prefs.googleFont);
        }
        forceContentTheme({ document: doc }, prefs.themeMode, fontFamily, prefs.fontSize);
      } catch {}
    },
    targetView ? [targetView] : [],
  );

  const colors = getThemeColors(prefs.themeMode);
  try {
    const views = rendition.manager?.views?._views as EpubThemeView[] | undefined;
    const themedIframes = new Set<HTMLIFrameElement>();
    for (const view of views ?? []) {
      try {
        if (view.iframe && !themedIframes.has(view.iframe)) {
          themedIframes.add(view.iframe);
          view.iframe.style.setProperty('background-color', colors.background, 'important');
        }
      } catch {}
    }
    if (targetView?.iframe && !themedIframes.has(targetView.iframe)) {
      targetView.iframe.style.setProperty('background-color', colors.background, 'important');
    }
  } catch {}
}
