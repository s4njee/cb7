import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUiStore } from '@/store/uiStore';
import * as api from '@/lib/api';
import LibraryGrid from '@/components/library/LibraryGrid';
import SelectionBar from '@/components/library/SelectionBar';
import Breadcrumb from '@/components/library/Breadcrumb';
import { itemCountLabel } from '@/lib/utils';

export default function ContinuePage() {
  const { mediaType } = useUiStore();

  // Query for continue reading items
  const { data: records = [], isLoading } = useQuery<api.WebComicRecord[]>({
    queryKey: ['continue-reading', 'flat', mediaType],
    queryFn: () => api.fetchContinueReading(200, mediaType || undefined),
    staleTime: 30000,
  });

  return (
    <div className="flex flex-col min-h-full">
      <div className="p-4 border-b border-border bg-card/10 select-none flex items-center justify-between">
        <Breadcrumb />
        <span className="text-xs text-muted-foreground">
          {itemCountLabel(records.length)}
        </span>
      </div>

      <div className="flex-1">
        <LibraryGrid
          comics={records}
          isLoading={isLoading}
          emptyMessage="No in-progress items found."
        />
      </div>

      <SelectionBar />
    </div>
  );
}
