import { useUiStore } from '@/store/uiStore';
import {
  comicQueryOptionsFromFilters,
  hierarchyQueryOptionsFromFilters,
} from '@/lib/catalogQueryHelpers';

export function useFolderRouteOptions() {
  const {
    mediaType,
    sortBy,
    sortOrder,
    search,
    fileExt,
    readStatus,
    favoritesOnly,
  } = useUiStore();

  const groupFilters = hierarchyQueryOptionsFromFilters({
    mediaType,
    search,
    fileExt,
    readStatus,
    favoritesOnly,
  });

  const queryOpts = comicQueryOptionsFromFilters({
    mediaType,
    sortBy,
    sortOrder,
    fileExt,
    readStatus,
    favoritesOnly,
  }, { defaultSortBy: 'title' });

  return { groupFilters, queryOpts };
}
