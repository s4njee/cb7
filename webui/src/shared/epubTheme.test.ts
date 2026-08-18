import { describe, expect, it } from 'vitest';
import {
  buildEpubFontSizeCss,
  buildEpubTheme,
  toEpubFontSizePercent,
} from './epubTheme';

describe('epubTheme font size', () => {
  it('scales user-facing percentages through the epub base factor', () => {
    expect(toEpubFontSizePercent(100)).toBe('85%');
    expect(toEpubFontSizePercent(120)).toBe('102%');
  });

  it('includes font-size rules in the default epub theme', () => {
    const theme = buildEpubTheme('black', 'Georgia, serif', 120);
    expect(theme.html['font-size']).toBe('102% !important');
    expect(theme.body['font-size']).toBe('100% !important');
  });

  it('builds inherit-based font-size css for iframe injection', () => {
    const css = buildEpubFontSizeCss(130);
    expect(css).toContain('html { font-size: 111% !important; }');
    expect(css).toContain('body { font-size: 100% !important; }');
    expect(css).toContain('p, div, span');
    expect(css).toContain('font-size: inherit !important');
  });
});
describe('buildEpubTheme line spacing and margins (P3-5)', () => {
  it('defaults to the original 1.6 line-height and 44px padding', () => {
    const theme = buildEpubTheme('black', 'Georgia, serif');
    expect(theme.body['line-height']).toBe('1.6');
    expect(theme.body.padding).toBe('44px');
  });

  it('honours custom line spacing and page margin', () => {
    const theme = buildEpubTheme('black', 'Georgia, serif', 100, { lineSpacing: 2.0, pageMargin: 24 });
    expect(theme.body['line-height']).toBe('2');
    expect(theme.body.padding).toBe('24px');
  });

  it('adds optional book-like heading flourishes without changing the default theme', () => {
    const plain = buildEpubTheme('black', 'Georgia, serif');
    const flourished = buildEpubTheme('black', 'Georgia, serif', 100, {
      typographicFlourishes: true,
    });

    expect(plain['h1, h2, h3']).toBeUndefined();
    expect(flourished['h1, h2, h3']).toMatchObject({
      'font-variant': 'small-caps',
    });
  });
});
