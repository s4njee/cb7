import { describe, expect, it } from 'vitest';
import {
  determineReaderFormat,
  initialReaderPage,
  readerChromeKeyAction,
  type ReaderFormatRecord,
} from './readerPageHelpers';

describe('readerPageHelpers', () => {
  it('uses a positive route page before saved progress', () => {
    expect(initialReaderPage('7', 2)).toBe(7);
  });

  it('falls back to saved progress converted from zero-indexed storage', () => {
    expect(initialReaderPage(undefined, 0)).toBe(1);
    expect(initialReaderPage(undefined, 4)).toBe(5);
  });

  it('falls back to page one for missing or invalid route progress', () => {
    expect(initialReaderPage(undefined, null)).toBe(1);
    expect(initialReaderPage('0', null)).toBe(1);
    expect(initialReaderPage('nope', null)).toBe(1);
  });

  it('detects comic archive records', () => {
    expect(determineReaderFormat(record({ mediaType: 'comic', fileExt: 'epub' }))).toBe('comic');
    expect(determineReaderFormat(record({ fileExt: 'CBZ' }))).toBe('comic');
    expect(determineReaderFormat(record({ fileExt: 'cbr' }))).toBe('comic');
  });

  it('detects known book formats by extension', () => {
    expect(determineReaderFormat(record({ fileExt: 'epub' }))).toBe('epub');
    expect(determineReaderFormat(record({ fileExt: 'pdf' }))).toBe('pdf');
  });

  it('uses fallback reader guesses when extension data is unavailable', () => {
    expect(determineReaderFormat(record({ fileExt: '', pageCount: 0 }))).toBe('epub');
    expect(determineReaderFormat(record({ fileExt: '', lastLocation: 'epubcfi(/6/2)' }))).toBe('epub');
    expect(determineReaderFormat(record({ fileExt: '', pageCount: 12 }))).toBe('pdf');
    expect(determineReaderFormat(record({ fileExt: '', lastPage: 1, pageCount: 0 }))).toBe('epub');
  });

  it('maps chrome shortcuts to back and fullscreen commands', () => {
    expect(readerChromeKeyAction('Escape')).toBe('back');
    expect(readerChromeKeyAction('f')).toBe('fullscreen');
    expect(readerChromeKeyAction('F')).toBe('fullscreen');
    expect(readerChromeKeyAction('ArrowRight')).toBeNull();
  });

  it('never fires chrome shortcuts from form fields, dialogs, or handled events', () => {
    expect(readerChromeKeyAction('f', { isEditableTarget: true })).toBeNull();
    expect(readerChromeKeyAction('Escape', { isDialogTarget: true })).toBeNull();
    expect(readerChromeKeyAction('Escape', { defaultPrevented: true })).toBeNull();
  });
});

function record(overrides: Partial<ReaderFormatRecord>): ReaderFormatRecord {
  return {
    mediaType: 'book' as const,
    fileExt: '',
    pageCount: 0,
    lastPage: null,
    lastLocation: null,
    ...overrides,
  };
}
