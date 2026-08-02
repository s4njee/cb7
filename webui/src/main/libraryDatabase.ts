/**
 * @module
 * Main Database Facade
 *
 * Architecture overview for Junior Devs:
 * The `LibraryDatabase` class acts as the single entry point (Facade pattern) for all
 * database operations. Instead of writing a massive 2000-line class, the actual SQL logic is
 * split into domain-specific modules in `src/main/db/` (e.g., `comics.ts`, `folders.ts`).
 *
 * Why this pattern?
 * 1. Testability: We can test the free functions in `src/main/db/` easily by passing a mock
 *    or throwaway database to them.
 * 2. Simplicity for the caller: The web routes and ingest service just take a `LibraryDatabase`
 *    instance and `await db.getComic(1)` without needing to import 15 different files.
 *
 * Each method delegates to the corresponding free function, passing the internal Postgres
 * handle. Every method is async (Postgres' driver is promise-based); callers `await` them.
 */

import type { MediaRecord, QueryOptions, QueryResult } from '../shared/types';
import { openPg } from './db/schema/openPg';
import type { PgDatabase, PgTx } from './db/pg';
import * as appMeta from './db/appMeta';
import * as tags from './db/tags';
import * as bookmarks from './db/bookmarks';
import * as pairTokens from './db/pairTokens';
import * as favorites from './db/favorites';
import * as users from './db/users';
import * as history from './db/history';
import * as progress from './db/progress';
import * as libraries from './db/libraries';
import * as folders from './db/folders';
import * as comics from './db/comics';
import * as jobs from './db/jobs';
import * as ingestErrors from './db/ingestErrors';
import * as maintenance from './db/maintenance';
import * as ebookSearch from './db/ebookSearch';
import * as searchIndexer from './search/indexer';

export class LibraryDatabase {
  // Set in initialize(); the standalone entry always calls initialize() before
  // any query runs, so the definite-assignment assertion is safe.
  private db!: PgDatabase;

  constructor(private readonly connectionString: string) {}

  /** Connect to Postgres and ensure the schema exists. Must run before any query. */
  async initialize(): Promise<void> {
    this.db = await openPg(this.connectionString);
  }

  /** The underlying pg Pool — handed to the better-auth adapter. */
  get pool() {
    return this.db.pool_;
  }

  /** Close the connection pool (graceful shutdown). */
  async close(): Promise<void> {
    await this.db.close();
  }

  /**
   * Run a function inside a single Postgres transaction on a dedicated client.
   * Used by the ingest pipeline to batch many inserts into one commit. The
   * callback receives a transaction handle to pass to DAO free functions.
   */
  runInTransaction<T>(fn: (tx: PgTx) => Promise<T>): Promise<T> {
    return this.db.tx(fn);
  }

  // --- app_meta ---
  getAppMeta(key: string) { return appMeta.getAppMeta(this.db, key); }
  setAppMeta(key: string, value: string) { return appMeta.setAppMeta(this.db, key, value); }

  // --- comics ---
  addComic(record: Omit<MediaRecord, 'id' | 'dateAdded'>) { return comics.addComic(this.db, record); }
  addComicFast(record: { filePath: string; title: string; pageCount: number; fileSize: number; coverThumbnail: Buffer; mediaType: 'comic' | 'book' }) {
    return comics.addComicFast(this.db, record);
  }
  addComicsToFolderRaw(folderId: number, comicIds: number[]) {
    return folders.addComicsToFolderRaw(this.db, folderId, comicIds);
  }
  removeComics(ids: number[]) { return comics.removeComics(this.db, ids); }
  isDismissed(filePath: string) { return comics.isDismissed(this.db, filePath); }
  getComic(id: number) { return comics.getComic(this.db, id); }
  /** Light single-comic fetch: no cover blob, no tags. For hot read paths. */
  getComicLite(id: number) { return comics.getComicLite(this.db, id); }
  comicExistsByPath(filePath: string) { return comics.comicExistsByPath(this.db, filePath); }
  updateCoverThumbnailByPath(filePath: string, coverThumbnail: Buffer | null) {
    return comics.updateCoverThumbnailByPath(this.db, filePath, coverThumbnail);
  }
  updatePageCountByPath(filePath: string, pageCount: number) {
    return comics.updatePageCountByPath(this.db, filePath, pageCount);
  }
  getComicByPath(filePath: string) { return comics.getComicByPath(this.db, filePath); }
  getCoverThumbnail(comicId: number) { return comics.getCoverThumbnail(this.db, comicId); }
  updateReadingProgress(comicId: number, pageIndex: number) {
    return comics.updateReadingProgress(this.db, comicId, pageIndex);
  }
  updateReadingLocation(comicId: number, location: string) {
    return comics.updateReadingLocation(this.db, comicId, location);
  }
  updateReadingPercent(comicId: number, percent: number) {
    return comics.updateReadingPercent(this.db, comicId, percent);
  }

  // --- Ebook full-text + semantic search (pgvector) ---
  ftsCandidates(q: string, limit: number) { return ebookSearch.ftsCandidates(this.db, q, limit); }
  vectorCandidates(queryVec: number[], limit: number) { return ebookSearch.vectorCandidates(this.db, queryVec, limit); }
  indexBook(comicId: number, filePath: string) { return searchIndexer.indexBook(this.db, comicId, filePath); }
  backfillBooks() { return searchIndexer.backfillBooks(this.db); }
  clearEbookIndex() { return ebookSearch.clearAllEbookChunks(this.db); }
  getRecentlyRead(limit: number = 10, mediaType?: 'comic' | 'book') {
    return comics.getRecentlyRead(this.db, limit, mediaType);
  }
  getContinueReading(limit: number = 10, mediaType?: 'comic' | 'book') {
    return comics.getContinueReading(this.db, limit, mediaType);
  }
  setComicSeries(comicId: number, seriesName: string | null, volumeNumber: number | null, chapterNumber: number | null) {
    return comics.setComicSeries(this.db, comicId, seriesName, volumeNumber, chapterNumber);
  }
  getAllSeries() { return comics.getAllSeries(this.db); }
  getSeriesComics(name: string) { return comics.getSeriesComics(this.db, name); }
  updateComicMetadata(comicId: number, fields: Parameters<typeof comics.updateComicMetadata>[2]) {
    return comics.updateComicMetadata(this.db, comicId, fields);
  }
  getComicMetadata(id: number) { return comics.getComicMetadata(this.db, id); }
  queryComicsForUser(userId: number | null, options: Parameters<typeof comics.queryComicsForUser>[2]) {
    return comics.queryComicsForUser(this.db, userId, options);
  }

  // --- tags ---
  addTag(comicId: number, tag: string) { return tags.addTag(this.db, comicId, tag); }
  removeTag(comicId: number, tag: string) { return tags.removeTag(this.db, comicId, tag); }
  getAllTags() { return tags.getAllTags(this.db); }
  renameTag(oldName: string, newName: string) { return tags.renameTag(this.db, oldName, newName); }
  deleteTag(tag: string) { return tags.deleteTag(this.db, tag); }
  addTagBulk(comicIds: number[], tag: string) { return tags.addTagBulk(this.db, comicIds, tag); }
  removeTagBulk(comicIds: number[], tag: string) { return tags.removeTagBulk(this.db, comicIds, tag); }

  // --- libraries ---
  createLibrary(name: string, mediaType: 'comic' | 'book' = 'comic') {
    return libraries.createLibrary(this.db, name, mediaType);
  }
  renameLibrary(id: number, newName: string) { return libraries.renameLibrary(this.db, id, newName); }
  deleteLibrary(id: number) { return libraries.deleteLibrary(this.db, id); }
  getAllLibraries(mediaType?: 'comic' | 'book') { return libraries.getAllLibraries(this.db, mediaType); }
  addComicsToLibrary(libraryId: number, comicIds: number[]) {
    return libraries.addComicsToLibrary(this.db, libraryId, comicIds);
  }
  removeComicsFromLibrary(libraryId: number, comicIds: number[]) {
    return libraries.removeComicsFromLibrary(this.db, libraryId, comicIds);
  }
  addFoldersToLibrary(libraryId: number, folderIds: number[]) {
    return libraries.addFoldersToLibrary(this.db, libraryId, folderIds);
  }
  queryComicsByLibrary(libraryId: number, options: QueryOptions = {}): Promise<QueryResult> {
    return libraries.queryComicsByLibrary(this.db, libraryId, options);
  }

  // --- folders ---
  createFolder(name: string, comicIds: number[]) { return folders.createFolder(this.db, name, comicIds); }
  renameFolder(id: number, newName: string) { return folders.renameFolder(this.db, id, newName); }
  deleteFolder(id: number) { return folders.deleteFolder(this.db, id); }
  getAllFolders(libraryId?: number | null) { return folders.getAllFolders(this.db, libraryId); }
  getFolderThumbnail(folderId: number) { return folders.getFolderThumbnail(this.db, folderId); }
  addComicsToFolder(folderId: number, comicIds: number[]) {
    return folders.addComicsToFolder(this.db, folderId, comicIds);
  }
  removeComicsFromFolder(folderId: number, comicIds: number[]) {
    return folders.removeComicsFromFolder(this.db, folderId, comicIds);
  }
  getFolderComics(folderId: number, options: QueryOptions = {}): Promise<QueryResult> {
    return folders.getFolderComics(this.db, folderId, options);
  }
  getFolderSeriesGroups(userId: number | null, folderId: number, options: Parameters<typeof folders.getFolderSeriesGroups>[3] = {}) {
    return folders.getFolderSeriesGroups(this.db, userId, folderId, options);
  }
  getFolderVolumeGroups(userId: number | null, folderId: number, seriesKey: string, options: Parameters<typeof folders.getFolderVolumeGroups>[4] = {}) {
    return folders.getFolderVolumeGroups(this.db, userId, folderId, seriesKey, options);
  }
  getFolderChapterGroups(userId: number | null, folderId: number, seriesKey: string, volumeKey: string, options: Parameters<typeof folders.getFolderChapterGroups>[5] = {}) {
    return folders.getFolderChapterGroups(this.db, userId, folderId, seriesKey, volumeKey, options);
  }
  getFolderVolumeComicsForUser(
    userId: number | null,
    folderId: number,
    seriesKey: string,
    volumeKey: string,
    chapterKey: string | null,
    options: Parameters<typeof folders.getFolderVolumeComicsForUser>[6] = {},
  ) {
    return folders.getFolderVolumeComicsForUser(this.db, userId, folderId, seriesKey, volumeKey, chapterKey, options);
  }
  getComicFolderIds(comicId: number) { return folders.getComicFolderIds(this.db, comicId); }
  getFolderFilePaths(folderId: number) { return folders.getFolderFilePaths(this.db, folderId); }

  // Global (library-wide) hierarchy — no folder scope, used by search/browse view.
  getGlobalSeriesGroups(userId: number | null, options: Parameters<typeof folders.getGlobalSeriesGroups>[2] = {}) {
    return folders.getGlobalSeriesGroups(this.db, userId, options);
  }
  getGlobalVolumeGroups(userId: number | null, seriesKey: string, options: Parameters<typeof folders.getGlobalVolumeGroups>[3] = {}) {
    return folders.getGlobalVolumeGroups(this.db, userId, seriesKey, options);
  }
  getGlobalChapterGroups(userId: number | null, seriesKey: string, volumeKey: string, options: Parameters<typeof folders.getGlobalChapterGroups>[4] = {}) {
    return folders.getGlobalChapterGroups(this.db, userId, seriesKey, volumeKey, options);
  }
  getGlobalVolumeComicsForUser(
    userId: number | null,
    seriesKey: string,
    volumeKey: string,
    chapterKey: string | null,
    options: Parameters<typeof folders.getGlobalVolumeComicsForUser>[5] = {},
  ) {
    return folders.getGlobalVolumeComicsForUser(this.db, userId, seriesKey, volumeKey, chapterKey, options);
  }

  // --- users ---
  createUser(username: string, passwordHash: string, isAdmin: boolean) {
    return users.createUser(this.db, username, passwordHash, isAdmin);
  }
  getUserByUsername(username: string) { return users.getUserByUsername(this.db, username); }
  getUserById(id: number) { return users.getUserById(this.db, id); }
  listUsers() { return users.listUsers(this.db); }
  countAdmins() { return users.countAdmins(this.db); }
  countUsers() { return users.countUsers(this.db); }
  deleteUser(id: number) { return users.deleteUser(this.db, id); }
  setUserAdmin(id: number, isAdmin: boolean) { return users.setUserAdmin(this.db, id, isAdmin); }
  resetAdminCredentials(id: number, passwordHash: string, username: string) {
    return users.resetAdminCredentials(this.db, id, passwordHash, username);
  }
  upsertCredentialAccount(userId: number, accountId: string, passwordHash: string) {
    return users.upsertCredentialAccount(this.db, userId, accountId, passwordHash);
  }

  // --- per-user progress ---
  upsertUserProgress(
    userId: number,
    comicId: number,
    opts: { page?: number | null; location?: string | null; percent?: number | null; completed?: boolean },
  ) { return progress.upsertUserProgress(this.db, userId, comicId, opts); }
  clearUserProgress(userId: number, comicId: number) {
    return progress.clearUserProgress(this.db, userId, comicId);
  }
  getUserProgress(userId: number, comicId: number) {
    return progress.getUserProgress(this.db, userId, comicId);
  }
  getUserProgressForComics(userId: number, comicIds: number[]) {
    return progress.getUserProgressForComics(this.db, userId, comicIds);
  }
  getRecentlyReadByUser(userId: number, limit: number, mediaType?: 'comic' | 'book') {
    return progress.getRecentlyReadByUser(this.db, userId, limit, mediaType);
  }
  getContinueReadingByUser(userId: number, limit: number, mediaType?: 'comic' | 'book') {
    return progress.getContinueReadingByUser(this.db, userId, limit, mediaType);
  }

  // --- bookmarks ---
  createBookmark(userId: number, comicId: number, anchor: bookmarks.BookmarkAnchor, note: string | null = null) {
    return bookmarks.createBookmark(this.db, userId, comicId, anchor, note);
  }
  listBookmarks(userId: number, comicId: number) {
    return bookmarks.listBookmarks(this.db, userId, comicId);
  }
  updateBookmark(userId: number, bookmarkId: number, note: string | null) {
    return bookmarks.updateBookmark(this.db, userId, bookmarkId, note);
  }
  deleteBookmark(userId: number, bookmarkId: number) {
    return bookmarks.deleteBookmark(this.db, userId, bookmarkId);
  }

  // --- QR pairing tokens ---
  // `tokenHash` is always sha256(token) hex; the plaintext token never crosses
  // this boundary. See db/pairTokens.ts for why consume is a single DELETE.
  createPairToken(userId: number, tokenHash: string, expiresAt: Date) {
    return pairTokens.createPairToken(this.db, userId, tokenHash, expiresAt);
  }
  consumePairToken(tokenHash: string) {
    return pairTokens.consumePairToken(this.db, tokenHash);
  }
  sweepExpiredPairTokens() {
    return pairTokens.sweepExpiredPairTokens(this.db);
  }

  // --- reading history ---
  logHistory(userId: number, comicId: number, action: string, page: number | null) {
    return history.logHistory(this.db, userId, comicId, action, page);
  }
  getHistory(userId: number, offset: number, limit: number) {
    return history.getHistory(this.db, userId, offset, limit);
  }

  // --- favorites ---
  addFavorite(userId: number, comicId: number) { return favorites.addFavorite(this.db, userId, comicId); }
  removeFavorite(userId: number, comicId: number) { return favorites.removeFavorite(this.db, userId, comicId); }
  isFavorite(userId: number, comicId: number) { return favorites.isFavorite(this.db, userId, comicId); }
  getFavoritedComicIds(userId: number, comicIds: number[]) {
    return favorites.getFavoritedComicIds(this.db, userId, comicIds);
  }

  // --- background jobs (scan_jobs progress mirror) ---
  createScanJob(input: Parameters<typeof jobs.createScanJob>[1]) { return jobs.createScanJob(this.db, input); }
  updateScanProgress(id: string, patch: Parameters<typeof jobs.updateScanProgress>[2]) {
    return jobs.updateScanProgress(this.db, id, patch);
  }
  getScanJob(id: string) { return jobs.getScanJob(this.db, id); }
  listActiveScanJobs(limit?: number) { return jobs.listActiveScanJobs(this.db, limit); }
  findActiveScanByPath(targetPath: string) { return jobs.findActiveScanByPath(this.db, targetPath); }

  // --- ingest error log (shared by the worker writer + the API reader) ---
  recordIngestError(record: Parameters<typeof ingestErrors.recordIngestError>[1]) {
    return ingestErrors.recordIngestError(this.db, record);
  }
  getRecentIngestErrors(limit?: number) { return ingestErrors.getRecentIngestErrors(this.db, limit); }
  countIngestErrors() { return ingestErrors.countIngestErrors(this.db); }
  clearIngestErrors() { return ingestErrors.clearIngestErrors(this.db); }

  // --- maintenance ---
  /** Wipe all catalog rows; preserves users, sessions, app_meta. */
  clearLibrary() { return maintenance.clearLibrary(this.db); }
}
