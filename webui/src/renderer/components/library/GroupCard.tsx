import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { PLACEHOLDER_BOOK_SVG_DATA_URI } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface GroupCardProps {
  title: string;
  count: number;
  badgeLabel: string;
  thumbnailUrl: string | null;
  href: string;
  metaLabel?: string;
}

export default function GroupCard({
  title,
  count,
  badgeLabel,
  thumbnailUrl,
  href,
  metaLabel,
}: GroupCardProps) {
  const navigate = useNavigate();
  const [imgLoading, setImgLoading] = useState(true);
  const [imgSrc, setImgSrc] = useState<string>(thumbnailUrl || PLACEHOLDER_BOOK_SVG_DATA_URI);

  const handleClick = () => {
    navigate(href);
  };

  return (
    <div
      onClick={handleClick}
      className="relative flex flex-col group rounded-lg overflow-hidden bg-card border border-border hover:border-primary/50 transition-all duration-200 shadow-md select-none cursor-pointer h-full"
    >
      {/* 1. Thumbnail Wrap */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-secondary border-b border-border">
        <img
          src={imgSrc}
          alt={title}
          loading="lazy"
          className={cn(
            "object-cover w-full h-full transition-transform duration-300 group-hover:scale-105",
            imgLoading ? "opacity-30 blur-xs" : "opacity-100"
          )}
          onLoad={() => setImgLoading(false)}
          onError={() => {
            setImgLoading(false);
            setImgSrc(PLACEHOLDER_BOOK_SVG_DATA_URI);
          }}
        />

        {/* Group Badge */}
        <Badge className="absolute top-2 right-2 z-10 bg-secondary text-foreground hover:bg-secondary font-bold text-[9px] px-1.5 py-0.5 border border-border">
          {badgeLabel}
        </Badge>

        {/* Count overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2 pt-6 flex items-end">
          <span className="text-[10px] text-white font-medium">
            {metaLabel || `${count} item${count === 1 ? '' : 's'}`}
          </span>
        </div>
      </div>

      {/* 2. Info Area */}
      <div className="p-2 flex-1 flex flex-col justify-between">
        <h4 className="text-xs font-semibold line-clamp-2 text-foreground group-hover:text-primary transition-colors leading-tight">
          {title}
        </h4>
      </div>
    </div>
  );
}
