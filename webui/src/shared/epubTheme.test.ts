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