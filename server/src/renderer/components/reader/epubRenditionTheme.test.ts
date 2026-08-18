import { describe, expect, it } from 'vitest';
import { applyEpubThemeToRendition, forEachRenditionDocument } from './epubRenditionTheme';
import type { EpubRendition } from './EpubReaderTypes';

describe('forEachRenditionDocument', () => {
  it('visits documents from both getContents and mounted views', () => {
    const docA = { nodeType: 9 } as Document;
    const docB = { nodeType: 9 } as Document;
    const visited: Document[] = [];

    const rendition = {
      getContents: () => [{ document: docA }],
      manager: {
        views: {
          _views: [{ document: docB, contents: { document: docA } }],
        },
      },
    } as unknown as EpubRendition;

    forEachRenditionDocument(rendition, (doc) => {
      visited.push(doc);
    });

    expect(visited).toEqual([docA, docB]);
  });

  it('visits mounted iframe documents when epub.js does not expose a contents document', () => {
    const iframeDoc = { nodeType: 9 } as Document;
    const visited: Document[] = [];

    const rendition = {
      getContents: () => [],
      manager: {
        views: {
          _views: [
            {
              iframe: { contentDocument: iframeDoc },
            },
          ],
        },
      },
    } as unknown as EpubRendition;

    forEachRenditionDocument(rendition, (doc) => {
      visited.push(doc);
    });

    expect(visited).toEqual([iframeDoc]);
  });

  it('applies theme settings to rendition themes and live iframe documents', () => {
    const docA = { nodeType: 9 } as Document;
    const docB = { nodeType: 9 } as Document;
    const docC = { nodeType: 9 } as Document;
    const calls: string[] = [];
    const iframeStyle = {
      setProperty: (name: string, value: string, priority?: string) => {
        calls.push(`iframe:${name}:${value}:${priority}`);
      },
    };

    const rendition = {
      getContents: () => [{ document: docA }],
      themes: {
        default: () => calls.push('theme:default'),
        font: (font: string) => calls.push(`theme:font:${font}`),
        override: (name: string, value: string, priority?: boolean) => {
          calls.push(`theme:override:${name}:${value}:${priority}`);
        },
      },
      manager: {
        views: {
          _views: [
            {
              contents: { document: docB },
              iframe: { style: iframeStyle },
            },
          ],
        },
      },
    } as unknown as EpubRendition;

    applyEpubThemeToRendition({
      rendition,
      prefs: { themeMode: 'black', fontSize: 120, googleFont: 'Literata' },
      fontFamily: 'Georgia, serif',
      targetView: {
        contents: { document: docC },
        iframe: { style: iframeStyle } as HTMLIFrameElement,
      },
      injectGoogleFont: (doc, font) => {
        const docLabel = doc === docA ? 'a' : doc === docB ? 'b' : 'c';
        calls.push(`font:${font}:${docLabel}`);
      },
      forceContentTheme: (contents, mode, font, fontSize) => {
        const docLabel = contents.document === docA ? 'a' : contents.document === docB ? 'b' : 'c';
        calls.push(`content:${mode}:${font}:${fontSize}:${docLabel}`);
      },
    });

    expect(calls).toContain('theme:default');
    expect(calls).toContain('theme:font:Georgia, serif');
    expect(calls).toContain('theme:override:font-size:102%:true');
    expect(calls).toContain('font:Literata:a');
    expect(calls).toContain('font:Literata:b');
    expect(calls).toContain('font:Literata:c');
    expect(calls).toContain('content:black:Georgia, serif:120:a');
    expect(calls).toContain('content:black:Georgia, serif:120:b');
    expect(calls).toContain('content:black:Georgia, serif:120:c');
    expect(calls).toContain('iframe:background-color:#0d0b0a:important');
  });
});
