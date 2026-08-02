/**
 * @module
 * Core Shared Type Definitions
 *
 * Architecture overview for Junior Devs:
 * These are the foundational data shapes that flow through the whole app, used
 * by both the Node side (`src/main/`) and the React side (`src/renderer/`).
 * `MediaRecord` is the most important one — almost everything in the library is
 * a `MediaRecord` (a comic or a book). If you're new, read `MediaRecord` and
 * `QueryOptions` first; most features touch one of them.
 *
 * Note: types describing the HTTP API response shapes live separately in
 * `apiTypes.ts`.
 */

/** One file entry inside an opened comic archive. */
export interface ArchiveEntry {
  filename: string;
  index: number;
}

/** Metadata about an opened archive plus its ordered page entries. */
export interface ArchiveHandle {
  filePath: string;
  format: 'cbz' | 'cbr';
  entries: ArchiveEntry[];
  pageCount: number;
}

/**
 * A single library item (comic or book) as stored and displayed.
 *
 * This is the canonical record shape. Reading-progress fields
 * (`lastPage`, `lastLocation`, `lastRead`) are per-user and get overlaid by the
 * server before being sent to the client.
 */
export interface MediaRecord {
  id: number;
  filePath: string;
  title: string;
  pageCount: number;
  fileSize: number;
  coverThumbnail: Buffer | null;
  hasThumbnail?: boolean;
  thumbnailVersion?: number;
  dateAdded: string;
  tags: string[];
  lastPage: number | null;
  lastLocation: string | null;
  /** Whole-book reading position 0-100 for reflowable formats (EPUB); null otherwise. */
  lastPercent: number | null;
  lastRead: string | null;
  mediaType: 'comic' | 'book';
}

/**
 * Filters, sorting, and paging for a library query.
 *
 * Every field is optional; an empty object means "all items, default
 * order". Used by both the renderer (building requests) and the DB layer
 * (translating into SQL).
 */
export interface QueryOptions {
  search?: string;
  tag?: string;
  sortBy?: 'title' | 'dateAdded' | 'fileSize' | 'pageCount' | 'lastRead';
  sortOrder?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
  excludeFoldered?: boolean;
  mediaType?: 'comic' | 'book';
  fileExt?: string;
  readStatus?: 'unread' | 'in-progress' | 'completed';
}

/** A user's saved filter + sort choices, persisted to `localStorage`. */
export interface FilterPreset {
  sortBy: QueryOptions['sortBy'];
  sortOrder: QueryOptions['sortOrder'];
  readStatus?: QueryOptions['readStatus'];
  fileExt?: string;
  tag?: string;
}

/** A page of query results plus the total match count for paging. */
export interface QueryResult {
  records: MediaRecord[];
  totalCount: number;
}

/** Progress snapshot emitted while scanning/ingesting a folder. */
export interface ScanProgress {
  discovered: number;
  processed: number;
  currentFile: string;
}

/** Reader navigation state shared between the reader and its chrome. */
export interface NavigationState {
  currentPage: number;
  totalPages: number;
  isFullscreen: boolean;
  archiveFilename: string | null;
}
