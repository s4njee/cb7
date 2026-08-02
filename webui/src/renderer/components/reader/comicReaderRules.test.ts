import { describe, expect, it } from 'vitest';
import type { ReaderPrefs } from '@/store/readerStore';
import {
  clampReaderPage,
  comicPageHintLabel,
  hasSecondSpreadPage,
  logicalTurnForPhysicalInput,
  nextComicSpreadPrefs,
  nextComicZoomMode,
  pageStepForSpread,
  preloadNeighborPageIndexes,
  slideClassForPageTurn,
} from './comicReaderRules';

const prefs: ReaderPrefs = {
  zoomMode: 'fit-height',
  direction: 'ltr',
  transition: 'slide',
  spread: 'single',
  upscale: false,
};

describe('comicReaderRules', () => {
  it('cycles through zoom modes in display order', () => {
    expect(nextComicZoomMode('fit-height')).toBe('fit-width');
    expect(nextComicZoomMode('fit-width')).toBe('original');
    expect(nextComicZoomMode('original')).toBe('fit-height');
  });

  it('maps spread mode to page step size', () => {
    expect(pageStepForSpread('single')).toBe(1);
    expect(pageStepForSpread('double')).toBe(2);
  });

  it('clamps reader pages to the valid 1-based range', () => {
    expect(clampReaderPage(-5, 10)).toBe(1);
    expect(clampReaderPage(4, 10)).toBe(4);
    expect(clampReaderPage(99, 10)).toBe(10);
  });

  it('maps physical input to logical turns based on reading direction', () => {
    expect(logicalTurnForPhysicalInput('ltr', 'right')).toBe('forward');
    expect(logicalTurnForPhysicalInput('ltr', 'left')).toBe('backward');
    expect(logicalTurnForPhysicalInput('rtl', 'right')).toBe('backward');
    expect(logicalTurnForPhysicalInput('rtl', 'left')).toBe('forward');
  });

  it('selects slide classes from page movement direction', () => {
    expect(slideClassForPageTurn(4, 5)).toBe('slide-from-right');
    expect(slideClassForPageTurn(4, 3)).toBe('slide-from-left');
    expect(slideClassForPageTurn(4, 4)).toBeNull();
  });

  it('toggles spread mode and resets zoom when entering double-page mode', () => {
    expect(nextComicSpreadPrefs({ ...prefs, spread: 'double', zoomMode: 'original' })).toEqual({ spread: 'single' });
    expect(nextComicSpreadPrefs({ ...prefs, spread: 'single', zoomMode: 'original' })).toEqual({
      spread: 'double',
      zoomMode: 'fit-height',
    });
    expect(nextComicSpreadPrefs({ ...prefs, spread: 'single', zoomMode: 'fit-height' })).toEqual({ spread: 'double' });
  });

  it('detects whether a double-page spread has a second page', () => {
    expect(hasSecondSpreadPage('single', 0, 5)).toBe(false);
    expect(hasSecondSpreadPage('double', 0, 5)).toBe(true);
    expect(hasSecondSpreadPage('double', 4, 5)).toBe(false);
  });

  it('formats the transient page hint', () => {
    expect(comicPageHintLabel('single', 3, 12)).toBe('3 / 12');
    expect(comicPageHintLabel('double', 3, 12)).toBe('3\u20134 / 12');
    expect(comicPageHintLabel('double', 12, 12)).toBe('12 / 12');
  });

  it('chooses neighboring pages to warm in navigation order', () => {
    expect(preloadNeighborPageIndexes(3, 10, 'single')).toEqual([4, 2]);
    expect(preloadNeighborPageIndexes(3, 10, 'double')).toEqual([4, 2, 5, 1]);
    expect(preloadNeighborPageIndexes(0, 3, 'double')).toEqual([1, 2]);
  });
});
