import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as api from '@/lib/api';
import { useUiStore } from '@/store/uiStore';
import { useInfiniteComics } from '@/hooks/useInfiniteComics';
import GroupCard from '@/components/library/GroupCard';
import FolderCard from '@/components/library/FolderCard';
import LibraryGrid from '@/components/library/LibraryGrid';
import SelectionBar from '@/components/library/SelectionBar';
import { Tag as TagIcon, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared responsive card grid used by the landing pages. */
const GRID =
  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-6 p-4';

/** Uppercase section header used atop each landing page. */
function LandingHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="px-4 md:px-10 pt-6 pb-3 flex items-baseline justify-between select-none">
      <h1 className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-section">{label}</h1>
      {count !== undefined && (
        <span className="text-xs text-faint">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center p-10 text-sm text-muted-foreground">{children}</div>;
}

/** Collections landing — a grid of the user's collections (was the sidebar list). */
export function CollectionsPage() {
  const { data: libraries = [], isLoading } = useQuery({
    queryKey: ['libraries'],
    queryFn: () => api.fetchLibraries(),
  });
  return (
    <div className="flex flex-col min-h-full">
      <LandingHeader label="Collections" count={libraries.length} />
      {isLoading ? (
        <Centered><Loader2 className="h-5 w-5 animate-spin text-primary" /></Centered>
      ) : libraries.length === 0 ? (
        <Centered>
          No collections yet. Use the + menu to create one, or select books and choose Create new collection…
        </Centered>
      ) : (
        <div className={GRID}>
          {libraries.map((lib) => (
            <div key={lib.id} className="h-full">
              <GroupCard
                title={lib.name}
                count={lib.comicCount}
                badgeLabel="Collection"
                thumbnailUrl={null}
                href={`/library/${lib.id}`}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Folders landing — a grid of watched folders (was the sidebar list). */
export function FoldersPage() {
  const { data: folders = [], isLoading } = useQuery({
    queryKey: ['folders'],
    queryFn: api.fetchFolders,
  });
  return (
    <div className="flex flex-col min-h-full">
      <LandingHeader label="Folders" count={folders.length} />
      {isLoading ? (
        <Centered><Loader2 className="h-5 w-5 animate-spin text-primary" /></Centered>
      ) : folders.length === 0 ? (
        <Centered>
          No folders yet. Use the + menu to create one, or select books and choose Create new folder…
        </Centered>
      ) : (
        <div className={GRID}>
          {folders.map((folder) => (
            <div key={folder.id} className="h-full">
              <FolderCard folder={folder} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tags landing — the tag cloud (was the sidebar chips). */
export function TagsPage() {
  const { data: tags = [], isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn: api.fetchTags,
  });
  return (
    <div className="flex flex-col min-h-full">
      <LandingHeader label="Tags" count={tags.length} />
      {isLoading ? (
        <Centered><Loader2 className="h-5 w-5 animate-spin text-primary" /></Centered>
      ) : tags.length === 0 ? (
        <Centered>No tags yet.</Centered>
      ) : (
        <div className="flex flex-wrap gap-2 px-4 md:px-10 pb-8">
          {tags.map((tagName) => (
            <Link
              key={tagName}
              to={`/tag/${encodeURIComponent(tagName)}`}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2 text-[13px] rounded-full border transition-colors',
                'bg-card text-muted-foreground border-border hover:text-foreground hover:border-popover-border',
              )}
            >
              <TagIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-40">{tagName}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Finished — every completed book/comic (the "Finished" header tab). */
export function FinishedPage() {
  const { mediaType } = useUiStore();
  const infiniteQuery = useInfiniteComics({
    mediaType: mediaType || undefined,
    readStatus: 'completed',
  });
  const comics = useMemo(
    () => infiniteQuery.data?.pages.flatMap((p) => p.records) ?? [],
    [infiniteQuery.data],
  );
  return (
    <div className="flex flex-col min-h-full">
      <LandingHeader label="Finished" count={comics.length} />
      <div className="flex-1">
        <LibraryGrid
          comics={comics}
          isLoading={infiniteQuery.isLoading}
          fetchNextPage={infiniteQuery.fetchNextPage}
          hasNextPage={infiniteQuery.hasNextPage}
          isFetchingNextPage={infiniteQuery.isFetchingNextPage}
          emptyMessage="Nothing finished yet — books you read to the end show up here."
        />
      </div>
      <SelectionBar />
    </div>
  );
}
