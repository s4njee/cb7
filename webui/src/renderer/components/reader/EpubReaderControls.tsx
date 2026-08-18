import { List, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EpubReaderControlsProps {
  onOpenChapters: () => void;
  onOpenSettings: () => void;
}

export default function EpubReaderControls({
  onOpenChapters,
  onOpenSettings,
}: EpubReaderControlsProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenChapters}
        title="Table of contents"
        aria-label="Table of contents"
        className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
      >
        <List className="h-4.5 w-4.5" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenSettings}
        title="Reader display settings"
        aria-label="Reader display settings"
        className="h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50"
      >
        <Type className="h-4.5 w-4.5" />
      </Button>
    </div>
  );
}
