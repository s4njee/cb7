/**
 * @module
 * Reader Page Setup Helpers
 *
 * Architecture overview for Junior Devs:
 * When the reader page opens, it has to answer two questions before it can render:
 * which page to start on, and which reader to use (the comic image reader, the
 * EPUB reader, or the PDF reader). This module holds those two pure decisions.
 *
 * Note `determineReaderFormat`: extension and media type give a confident answer
 * for most files, but some books lack a reliable extension, so it falls back to
 * heuristics based on stored reading-progress shape (e.g. an EPUB CFI location vs.
 * a numeric PDF page) to pick the best reader.
 */

/** The reader UI to render for a given item. */
export type ReaderFormat = 'comic' | 'epub' | 'pdf';

/** A chrome-level keyboard command shared by every reader format. */
export type ReaderChromeKeyAction = 'back' | 'fullscreen';

/** Context about the keydown needed to decide whether a shortcut may fire. */
export interface ReaderChromeKeyContext {
  /** Whether the event target is an editable control (input, textarea, select). */
  isEditableTarget?: boolean;
  /** Whether the event target sits inside an open dialog/sheet. */
  isDialogTarget?: boolean;
  /** Whether another handler already claimed the event (e.defaultPrevented). */
  defaultPrevented?: boolean;
}

/**
 * Map a keydown to a chrome-level reader command.
 *  Escape exits back to the library and `f` toggles fullscreen — for
 *          every reader format. Shortcuts never fire while typing in a form
 *          field, while a dialog/sheet owns the key (Escape should close the
 *          sheet, not the reader), or when another handler already consumed
 *          the event.
 * @param key The pressed key (`KeyboardEvent.key`).
 * @param context Whether the event targets an editable control or dialog, or
 *                was already handled.
 * @returns The chrome command, or `null` if the key should be ignored.
 */
export function readerChromeKeyAction(
  key: string,
  context: ReaderChromeKeyContext = {},
): ReaderChromeKeyAction | null {
  if (context.defaultPrevented || context.isEditableTarget || context.isDialogTarget) {
    return null;
  }
  if (key === 'Escape') return 'back';
  if (key === 'f' || key === 'F') return 'fullscreen';
  return null;
}

/** The subset of a media record needed to choose a reader format. */
export interface ReaderFormatRecord {
  mediaType: 'comic' | 'book';
  fileExt: string;
  pageCount: number;
  lastPage: number | null;
  lastLocation: string | null;
}

/**
 * Decide which page the reader should open on.
 * Honours an explicit, valid (>0) page from the route; otherwise resumes
 *          just after the last-read page, or starts at page 1 if there is none.
 * @param routePage The page number from the URL, if any.
 * @param lastPage The last-read page index, or `null` if never read.
 * @returns The 1-based page to open on.
 */
export function initialReaderPage(routePage: string | undefined, lastPage: number | null): number {
  if (routePage) {
    const pageNumber = parseInt(routePage, 10);
    if (!isNaN(pageNumber) && pageNumber > 0) {
      return pageNumber;
    }
  }

  return lastPage === null ? 1 : lastPage + 1;
}

/**
 * Determine which reader UI to use for a media record.
 * Resolves confidently by media type / extension first (comic, cbz, cbr,
 *          epub, pdf). For books with an ambiguous extension it falls back to
 *          progress-shape heuristics: no pages/progress or an `epubcfi` location
 *          implies EPUB; a positive page count with no location implies PDF;
 *          otherwise it defaults to EPUB.
 * @param record The media record's format-relevant fields.
 * @returns The reader format to render.
 */
export function determineReaderFormat(record: ReaderFormatRecord): ReaderFormat {
  const ext = (record.fileExt || '').toLowerCase();

  if (record.mediaType === 'comic' || ext === 'cbz' || ext === 'cbr') {
    return 'comic';
  }
  if (ext === 'epub') return 'epub';
  if (ext === 'pdf') return 'pdf';

  if (record.pageCount === 0 && !record.lastPage) return 'epub';
  if (record.lastLocation && record.lastLocation.includes('epubcfi')) return 'epub';
  if (record.pageCount > 0 && !record.lastLocation) return 'pdf';
  return 'epub';
}
