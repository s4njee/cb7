import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Folder as FolderIcon } from 'lucide-react';
import { PLACEHOLDER_BOOK_SVG_DATA_URI } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface FolderCardProps {
  folder: Folder;
}

export default function FolderCard({ folder }: FolderCardProps) {
  const navigate = useNavigate();
  const [imgLoading, setImgLoading] = useState(true);
  const [imgSrc, setImgSrc] = useState<string>(`/api/folders/${folder.id}/thumbnail`);
  const [hasError, setHasError] = useState(false);

  const handleClick = () => {
    navigate(`/folder/${folder.id}`);
  };

  return (
    <div
      onClick={handleClick}
      className="relative flex flex-col group rounded-lg overflow-hidden bg-card border border-border hover:border-primary/50 transition-all duration-200 shadow-md select-none cursor-pointer h-full"
    >
      {/* 1. Thumbnail Wrap */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-secondary border-b border-border flex items-center justify-center">
        {hasError ? (
          // Folder fallback: large FolderIcon
          <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground w-full h-full bg-[#141414]">
            <FolderIcon className="h-12 w-12 text-primary/60 stroke-[1.5]" />
            <span className="text-[10px] uppercase font-bold tracking-wider">Folder</span>
          </div>
        ) : (
          <img
            src={imgSrc}
            alt={folder.name}
            loading="lazy"
            className={cn(
              "object-cover w-full h-full transition-transform duration-300 group-hover:scale-105",
              imgLoading ? "opacity-30 blur-xs" : "opacity-100"
            )}
            onLoad={() => setImgLoading(false)}
            onError={() => {
              setImgLoading(false);
              setHasError(true);
            }}
          />
        )}

        {/* Group Badge */}
        <Badge className="absolute top-2 right-2 z-10 bg-primary/20 text-primary hover:bg-primary/20 font-bold text-[9px] px-1.5 py-0.5 border border-primary/30">
          Folder
        </Badge>

        {/* Count overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 pt-6 flex items-end">
          <span className="text-[10px] text-white font-medium">
            {folder.comicCount} item{folder.comicCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* 2. Info Area */}
      <div className="p-2 flex-1 flex flex-col justify-between">
        <h4 className="text-xs font-semibold line-clamp-2 text-foreground group-hover:text-primary transition-colors leading-tight">
          {folder.name}
        </h4>
      </div>
    </div>
  );
}
