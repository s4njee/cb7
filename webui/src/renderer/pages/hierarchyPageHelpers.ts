import { GROUP_NONE_KEY } from '../lib/utils';

/**
 * @module
 * Series/Volume/Chapter Hierarchy Page Helpers
 *
 * Architecture overview for Junior Devs:
 * The browse pages present a library as a series → volume → chapter hierarchy.
 * Some of those groups are "unnumbered" (the `GROUP_NONE_KEY` bucket, for items
 * with no volume/chapter number), and the UI has rules about when to collapse or
 * hide those levels. This module holds those pure rules plus the helpers that flatten
 * paginated API results and build the navigation URLs. Keeping them separate lets
 * the page components stay focused on layout and these decisions be unit tested.
 *
 * Note the href helpers: when a chapter contains exactly one comic, they link
 * straight to the reader rather than to another (pointless) one-item browse level.
 */

/** A hierarchy group (series, volume, or chapter) with its key and item count. */
interface HierarchyGroup {
  key: string;
  count: number;
}

/** A chapter group that may resolve to a single comic. */
interface ChapterLike extends HierarchyGroup {
  singleComicId?: number;
}

/** Paginated API result shape (React Query infinite-query pages). */
interface PagedRecords<T> {
  pages: Array<{
    records: T[];
    totalCount: number;
  }>;
}

/**
 * Whether the only volume group is the unnumbered bucket.
 * Signals the volume level can be collapsed entirely (a flat series).
 * @param volumeGroups The series' volume groups.
 * @returns `true` when there is exactly one group and it is the "none" bucket.
 */
export function isSingleUnnumberedVolume(volumeGroups: Array<Pick<HierarchyGroup, 'key'>>): boolean {
  return volumeGroups.length === 1 && volumeGroups[0].key === GROUP_NONE_KEY;
}

/**
 * Whether any volume group is the unnumbered bucket.
 * @param volumeGroups The series' volume groups.
 * @returns `true` if a "none" bucket is present.
 */
export function hasUnnumberedVolume(volumeGroups: Array<Pick<HierarchyGroup, 'key'>>): boolean {
  return volumeGroups.some((group) => group.key === GROUP_NONE_KEY);
}

/**
 * Filter out the unnumbered bucket, keeping only numbered volumes.
 * @typeParam T The concrete volume-group type.
 * @param volumeGroups The series' volume groups.
 * @returns Only the groups with a real volume key.
 */
export function namedVolumeGroups<T extends Pick<HierarchyGroup, 'key'>>(volumeGroups: T[]): T[] {
  return volumeGroups.filter((group) => group.key !== GROUP_NONE_KEY);
}

/**
 * Decide whether the chapter level is worth displaying.
 * Show it when there are multiple chapter groups, or a single numbered
 *          chapter group that itself holds more than one item. A lone unnumbered
 *          or single-item chapter group is not worth its own level.
 * @param chapterGroups The volume's chapter groups.
 * @returns `true` if chapter groups should be shown.
 */
export function shouldShowChapterGroups(chapterGroups: HierarchyGroup[]): boolean {
  return (
    chapterGroups.length > 1 ||
    (chapterGroups.length === 1 &&
      chapterGroups[0].key !== GROUP_NONE_KEY &&
      chapterGroups[0].count > 1)
  );
}

/**
 * Flatten an infinite-query result into a single records array.
 * @typeParam T The record type.
 * @param data The paginated query data, if loaded.
 * @returns All records across pages, or an empty array when undefined.
 */
export function recordsFromPages<T>(data: PagedRecords<T> | undefined): T[] {
  return data ? data.pages.flatMap((page) => page.records) : [];
}

/**
 * Read the total record count reported by the first page.
 * @param data The paginated query data, if loaded.
 * @returns The first page's `totalCount`, or 0 when unavailable.
 */
export function firstPageTotalCount(data: Pick<PagedRecords<unknown>, 'pages'> | undefined): number {
  return data?.pages[0]?.totalCount ?? 0;
}

/**
 * Build the browse URL for a chapter in the main library.
 * Links straight to the reader when the chapter is a single comic;
 *          otherwise to the chapter's browse route. Path segments are URL-encoded.
 * @param seriesKey The series group key.
 * @param volumeKey The volume group key.
 * @param chapter The chapter group (may resolve to one comic).
 * @returns The destination URL.
 */
export function browseChapterHref(seriesKey: string, volumeKey: string, chapter: ChapterLike): string {
  if (chapter.singleComicId && chapter.count === 1) {
    return `/read/${chapter.singleComicId}`;
  }

  return `/browse/series/${encodeURIComponent(seriesKey)}/volume/${encodeURIComponent(volumeKey)}/chapter/${encodeURIComponent(chapter.key)}`;
}

/**
 * Build the browse URL for a chapter within a specific folder.
 * Same single-comic shortcut as `browseChapterHref`, but scoped to a
 *          folder's route. Path segments are URL-encoded.
 * @param folderId The folder's id.
 * @param seriesKey The series group key.
 * @param volumeKey The volume group key.
 * @param chapter The chapter group (may resolve to one comic).
 * @returns The destination URL.
 */
export function folderChapterHref(
  folderId: number,
  seriesKey: string,
  volumeKey: string,
  chapter: ChapterLike
): string {
  if (chapter.singleComicId && chapter.count === 1) {
    return `/read/${chapter.singleComicId}`;
  }

  return `/folder/${folderId}/series/${encodeURIComponent(seriesKey)}/volume/${encodeURIComponent(volumeKey)}/chapter/${encodeURIComponent(chapter.key)}`;
}
