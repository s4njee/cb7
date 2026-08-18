import type {
  BookmarkResponse,
  HistoryResponse as SharedHistoryResponse,
  IngestErrorLogEntryResponse,
  IngestErrorLogResponse as SharedIngestErrorLogResponse,
  InitialCredentialsResponse,
} from '../../../shared/apiTypes';

export interface WebComicRecord {
  id: number;
  title: string;
  pageCount: number;
  fileSize: number;
  dateAdded: string;
  tags: string[];
  lastPage: number | null;
  lastLocation: string | null;
  /** Whole-book reading position 0-100 for reflowable formats (EPUB); null otherwise. */
  lastPercent: number | null;
  lastRead: string | null;
  mediaType: 'comic' | 'book';
  thumbnailUrl: string;
  fileExt: string;
  favorited: boolean;
  /** ISO ts when the server last saw the file was missing from disk; null = file present. */
  missingAt: string | null;
  /** Absolute server path for the file (admin-visible contexts only; optional for safety). */
  filePath?: string;
}

export interface Folder {
  id: number;
  name: string;
  comicCount: number;
  mediaType: MediaType | 'mixed' | 'empty';
  thumbnailUrl: string | null;
}

/** A watched library root (a folder with a registered scan path), from GET /api/roots. */
export interface WatchedRoot {
  folderId: number;
  name: string;
  scanPath: string;
  enabled: boolean;
  comicCount: number;
  /** Whether the server can see the path (false = missing mount / offline). */
  pathExists: boolean;
  /** Unix ms of the last successful scan start, from the folder_scan_ts cursor. */
  lastScanAt: number | null;
  /** The newest scan_jobs row for this folder (active job or last outcome). */
  lastScanJob: {
    status: 'queued' | 'active' | 'done' | 'failed';
    error: string | null;
    added: number;
    updatedAt: string;
  } | null;
}

export interface Library {
  id: number;
  name: string;
  comicCount: number;
  mediaType: MediaType;
  /** When false only explicit members see this collection (P1-1). */
  everyone: boolean;
}

export interface SeriesGroup {
  key: string;
  name: string;
  count: number;
  coverComicId: number | null;
  thumbnailUrl: string | null;
}

export interface VolumeGroup {
  key: string;
  label: string;
  count: number;
  chapterCount: number;
  coverComicId: number | null;
  thumbnailUrl: string | null;
}

export interface ChapterGroup {
  key: string;
  label: string;
  count: number;
  coverComicId: number | null;
  thumbnailUrl: string | null;
  singleComicId?: number;
}

export interface GroupResponse<T> {
  groups: T[];
  totalCount: number;
}

export interface ComicListResponse {
  records: WebComicRecord[];
  totalCount: number;
}

export interface SessionResponse {
  authenticated: boolean;
  user: {
    id: number;
    username: string;
    isAdmin: boolean;
  } | null;
  host: boolean;
  guestAccess: boolean;
}

export type Bookmark = BookmarkResponse;
export type HistoryResponse = SharedHistoryResponse;
export type IngestErrorLogResponse = SharedIngestErrorLogResponse;

/** A single per-file ingest failure recorded against a scan job. */
export interface IngestFailureRecord {
  ts: string;
  path: string;
  ext: string;
  errorClass: string;
  message: string;
}

export interface IngestProgressEvent {
  type: 'progress';
  phase: 'discover' | 'process';
  discovered: number;
  processed: number;
  currentFile: string;
}

export interface IngestFailuresSummaryEvent {
  type: 'failures-summary';
  total: number;
  byClass: Record<string, number>;
  sample: Array<{
    path: string;
    errorClass: string;
    message: string;
  }>;
}

export interface IngestProgress {
  added: number;
  /** Files rejected as byte-identical duplicates during the scan. */
  duplicates: number;
  errors: string[];
  failuresSummary: IngestFailuresSummaryEvent | null;
}

export interface UploadResponse {
  added: number;
  skipped?: number;
  reason?: string;
  /** True when the upload was a byte-identical copy of an existing record. */
  duplicate?: boolean;
  filePath: string;
}

/** What `/api/admin/host-info` actually returns. It used to carry `isElectron`
 *  and `platform` for the retired desktop app; the standalone server sends
 *  neither, so declaring them was a type that lied to its only consumer. */
export interface HostInfo {
  homePath?: string;
}

export type InitialCredentials = InitialCredentialsResponse;

export interface ClearLibraryResponse {
  ok: boolean;
  removed: {
    comics: number;
    libraries: number;
    folders: number;
    tags: number;
    progress: number;
    bookmarks: number;
    history: number;
    favorites: number;
    dismissedPaths: number;
  };
}

export type MediaType = 'comic' | 'book';
export type SortBy = 'title' | 'dateAdded' | 'fileSize' | 'pageCount' | 'lastRead';
export type SortOrder = 'asc' | 'desc';
export type ReadStatus = 'unread' | 'in-progress' | 'completed';
export type FileExtension = 'cbz' | 'cbr' | 'cb7' | 'epub' | 'pdf' | 'mobi';
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface ComicQueryOptions extends QueryParams {
  mediaType?: MediaType;
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  search?: string;
  fileExt?: FileExtension | string;
  readStatus?: ReadStatus;
  favorites?: boolean;
  favoritesOnly?: boolean;
  tag?: string;
  limit?: number;
  offset?: number;
  excludeFoldered?: boolean;
  /** When set, only include records whose file is missing from disk (1) or present (0). */
  missing?: boolean;
}

export interface HierarchyQueryOptions extends QueryParams {
  mediaType?: MediaType;
  search?: string;
  fileExt?: FileExtension | string;
  readStatus?: ReadStatus;
  favorites?: boolean;
  limit?: number;
  offset?: number;
}

export interface AuthMutationResponse {
  ok?: boolean;
  user?: SessionResponse['user'];
  [key: string]: unknown;
}

export interface UserRecord {
  id: number;
  username: string;
  isAdmin: boolean;
  email?: string | null;
  name?: string | null;
  createdAt?: string | null;
}

export interface MetadataCandidate {
  title?: string;
  series?: string;
  externalId?: string;
  externalSource?: string;
  volume?: number | string | null;
  chapter?: number | string | null;
  author?: string | null;
  artist?: string | null;
  year?: number | null;
  genre?: string | null;
  authors?: string[];
  tags?: string[];
  summary?: string | null;
  description?: string | null;
  coverUrl?: string | null;
  source?: string;
  [key: string]: unknown;
}

export interface MetadataSearchResponse {
  results?: MetadataCandidate[];
  candidates?: MetadataCandidate[];
  warnings?: string[];
  [key: string]: unknown;
}

export type MetadataApplyResponse = Record<string, unknown>;

/**
 * The subset of comic metadata fields a batch edit can write.
 * `null` clears a field; absent keys are left untouched.
 */
export interface BatchMetadataFields {
  author?: string | null;
  seriesName?: string | null;
  volumeNumber?: number | null;
  year?: number | null;
  summary?: string | null;
  genre?: string | null;
  tags?: string[];
}

export interface AdminListDirEntry {
  name: string;
  path: string;
  isDir: boolean;
}

export interface AdminListDirResponse {
  dir: string;
  entries: AdminListDirEntry[];
}

export type IngestErrorLogEntry = IngestErrorLogEntryResponse;
