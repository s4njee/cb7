import { describe, expect, it } from 'vitest';
import {
  epubKeyboardAction,
  epubSwipeAction,
  epubTapAction,
} from './epubReaderInteractions';

describe('epubReaderInteractions', () => {
  it('maps keyboard shortcuts to navigation unless focus is in an editable control', () => {
    expect(epubKeyboardAction('ArrowRight')).toBe('next');
    expect(epubKeyboardAction(' ')).toBe('next');
    expect(epubKeyboardAction('ArrowLeft')).toBe('prev');
    expect(epubKeyboardAction('Backspace')).toBe('prev');
    expect(epubKeyboardAction('ArrowRight', 'INPUT')).toBeNull();
    expect(epubKeyboardAction('ArrowLeft', 'TEXTAREA')).toBeNull();
    expect(epubKeyboardAction('Backspace', 'SELECT')).toBeNull();
    expect(epubKeyboardAction('ArrowDown')).toBeNull();
  });

  it('maps chrome keys to back and fullscreen commands unless typing', () => {
    expect(epubKeyboardAction('Escape')).toBe('back');
    expect(epubKeyboardAction('f')).toBe('fullscreen');
    expect(epubKeyboardAction('F')).toBe('fullscreen');
    expect(epubKeyboardAction('Escape', 'INPUT')).toBeNull();
    expect(epubKeyboardAction('f', 'INPUT')).toBeNull();
  });

  it('turns sufficiently horizontal swipes into page navigation', () => {
    expect(epubSwipeAction(-60, 10)).toBe('next');
    expect(epubSwipeAction(60, 10)).toBe('prev');
    expect(epubSwipeAction(-50, 10)).toBeNull();
    expect(epubSwipeAction(-80, 100)).toBeNull();
  });

  it('maps stationary non-interactive taps to left, center, and right zones', () => {
    expect(epubTapAction(0, 0, 50, 300, false)).toBe('prev');
    expect(epubTapAction(0, 0, 150, 300, false)).toBe('toolbar');
    expect(epubTapAction(0, 0, 250, 300, false)).toBe('next');
  });

  it('ignores taps that moved too far or landed on interactive content', () => {
    expect(epubTapAction(10, 0, 50, 300, false)).toBeNull();
    expect(epubTapAction(0, 10, 50, 300, false)).toBeNull();
    expect(epubTapAction(0, 0, 50, 300, true)).toBeNull();
  });
});
