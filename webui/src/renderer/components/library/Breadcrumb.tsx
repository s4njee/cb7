import React from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder as FolderIcon } from 'lucide-react';
import * as api from '@/lib/api';
import { GROUP_NONE_KEY, numberLabel } from '@/lib/utils';

export default function Breadcrumb() {
  const location = useLocation();
  const params = useParams();

  // Queries to get the folder and library details for nice names in breadcrumbs
  const { data: folders = [] } = useQuery<api.Folder[]>({
    queryKey: ['folders'],
    queryFn: api.fetchFolders,
    staleTime: 60000,
  });

  const { data: libraries = [] } = useQuery<api.Library[]>({
    queryKey: ['libraries'],
    queryFn: () => api.fetchLibraries(),
    staleTime: 60000,
  });

  const path = location.pathname;

  // Build the breadcrumb segments list
  const segments: Array<{ label: string; to?: string }> = [
    { label: 'Library', to: '/' },
  ];

  if (path.startsWith('/recent')) {
    segments.push({ label: 'Recently Read' });
  } else if (path.startsWith('/continue')) {
    segments.push({ label: 'Continue Reading' });
  } else if (path.startsWith('/tag/')) {
    const tagName = params.name || '';
    segments.push({ label: 'Tags' });
    segments.push({ label: tagName });
  } else if (path.startsWith('/library/')) {
    const libraryId = Number(params.id);
    const lib = libraries.find((l) => l.id === libraryId);
    segments.push({ label: 'Collections' });
    segments.push({ label: lib?.name || 'Collection' });
  } else if (path.startsWith('/folder/')) {
    const folderId = Number(params.id);
    const folder = folders.find((f) => f.id === folderId);
    segments.push({ label: 'Folders', to: '/' });
    
    const folderLabel = folder?.name || 'Folder';
    const hasMoreSegments = !!params.k;
    
    segments.push({
      label: folderLabel,
      to: hasMoreSegments ? `/folder/${folderId}` : undefined,
    });

    if (params.k) {
      const seriesKey = params.k;
      const displaySeries = seriesKey === GROUP_NONE_KEY ? 'Unsorted' : seriesKey;
      const hasVolume = !!params.v;
      
      segments.push({
        label: displaySeries,
        to: hasVolume ? `/folder/${folderId}/series/${encodeURIComponent(seriesKey)}` : undefined,
      });

      if (params.v) {
        const volumeKey = params.v;
        const displayVolume = numberLabel(volumeKey, 'Unnumbered Volume', 'Volume');
        const hasChapter = !!params.c;

        segments.push({
          label: displayVolume,
          to: hasChapter ? `/folder/${folderId}/series/${encodeURIComponent(seriesKey)}/volume/${encodeURIComponent(volumeKey)}` : undefined,
        });

        if (params.c) {
          const chapterKey = params.c;
          const displayChapter = numberLabel(chapterKey, 'Unnumbered Chapter', 'Chapter');
          segments.push({ label: displayChapter });
        }
      }
    }
  } else if (path.startsWith('/browse/')) {
    segments.push({ label: 'Browse', to: '/' });

    if (params.k) {
      const seriesKey = params.k;
      const displaySeries = seriesKey === GROUP_NONE_KEY ? 'Unsorted' : seriesKey;
      const hasVolume = !!params.v;

      segments.push({
        label: displaySeries,
        to: hasVolume ? `/browse/series/${encodeURIComponent(seriesKey)}` : undefined,
      });

      if (params.v) {
        const volumeKey = params.v;
        const displayVolume = numberLabel(volumeKey, 'Unnumbered Volume', 'Volume');
        const hasChapter = !!params.c;

        segments.push({
          label: displayVolume,
          to: hasChapter ? `/browse/series/${encodeURIComponent(seriesKey)}/volume/${encodeURIComponent(volumeKey)}` : undefined,
        });

        if (params.c) {
          const chapterKey = params.c;
          const displayChapter = numberLabel(chapterKey, 'Unnumbered Chapter', 'Chapter');
          segments.push({ label: displayChapter });
        }
      }
    }
  }

  return (
    <nav className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-foreground uppercase select-none">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        const isFirst = index === 0;

        return (
          <React.Fragment key={index}>
            {!isFirst && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
            )}
            {segment.to && !isLast ? (
              <Link
                to={segment.to}
                className="text-muted-foreground hover:text-primary transition-colors cursor-pointer hover:underline underline-offset-4 decoration-primary/40 decoration-1"
              >
                {segment.label}
              </Link>
            ) : (
              <span className={isLast ? "text-primary normal-case font-bold" : "text-muted-foreground"}>
                {segment.label}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
