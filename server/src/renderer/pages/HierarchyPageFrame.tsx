import type { ReactNode } from 'react';
import Breadcrumb from '@/components/library/Breadcrumb';
import FilterStrips from '@/components/library/FilterStrips';
import SelectionBar from '@/components/library/SelectionBar';

interface HierarchyPageFrameProps {
  countLabel?: string;
  headerActions?: ReactNode;
  children: ReactNode;
}

export default function HierarchyPageFrame({
  countLabel,
  headerActions,
  children,
}: HierarchyPageFrameProps) {
  return (
    <div className="flex flex-col min-h-full">
      <div className="catalog-frame-head px-4 md:px-10 py-4 border-b border-header-rule bg-card/10 select-none flex items-center justify-between">
        <Breadcrumb />
        {headerActions ?? (
          <span className="text-xs text-muted-foreground">
            {countLabel}
          </span>
        )}
      </div>

      <FilterStrips />

      <div className="flex-1">
        {children}
      </div>

      <SelectionBar />
    </div>
  );
}
