import { describe, expect, it } from 'vitest';
import {
  clampPdfPage,
  isPdfRenderCancellation,
  pdfKeyboardAction,
  pdfSwipeAction,
  pdfTapAction,
} from './pdfReaderRules';

describe('pdfReaderRules', () => {
  it('clamps page numbers to the available PDF range', () => {
    expect(clampPdfPage(-4, 10)).toBe(1);
    expect(clampPdfPage(4, 10)).toBe(4);
    expect(clampPdfPage(14, 10)).toBe(10);
    expect(clampPdfPage(4, 0)).toBe(1);
  });

  it('maps page-turn keys and ignores form fields', () => {
    expect(pdfKeyboardAction('ArrowRight')).toBe('next');
    expect(pdfKeyboardAction(' ')).toBe('next');
    expect(pdfKeyboardAction('ArrowLeft')).toBe('prev');
    expect(pdfKeyboardAction('Backspace')).toBe('prev');
    expect(pdfKeyboardAction('ArrowRight', 'input')).toBeNull();
    expect(pdfKeyboardAction('Escape')).toBeNull();
  });

  it('maps left and right tap zones', () => {
    expect(pdfTapAction(20, 300)).toBe('prev');
    expect(pdfTapAction(280, 300)).toBe('next');
    expect(pdfTapAction(150, 300)).toBeNull();
    expect(pdfTapAction(20, 0)).toBeNull();
  });

  it('maps horizontal swipes above the threshold', () => {
    expect(pdfSwipeAction(-60)).toBe('next');
    expect(pdfSwipeAction(60)).toBe('prev');
    expect(pdfSwipeAction(50)).toBeNull();
  });

  it('recognizes pdf.js render cancellations', () => {
    const cancelled = new Error('cancelled');
    cancelled.name = 'RenderingCancelledException';

    expect(isPdfRenderCancellation(cancelled)).toBe(true);
    expect(isPdfRenderCancellation(new Error('boom'))).toBe(false);
    expect(isPdfRenderCancellation('RenderingCancelledException')).toBe(false);
  });
});
