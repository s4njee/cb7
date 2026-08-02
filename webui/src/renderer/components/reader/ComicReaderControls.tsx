import {
  ArrowLeftRight,
  Bookmark,
  Columns2,
  Heart,
  Lock,
  Maximize,
  Minimize,
  PanelTop,
  RotateCw,
  Smartphone,
  Sparkles,
  ZoomIn,
} from 'lucide-react';
import type { ReaderPrefs } from '@/store/readerStore';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ComicReaderControlsProps {
  prefs: ReaderPrefs;
  isBookmarked: boolean;
  isFavorite: boolean;
  isFullscreen: boolean;
  orientationLocked: boolean;
  orientationSupported: boolean;
  fullscreenSupported: boolean;
  isStandalone: boolean;
  onCycleZoom: () => void;
  onToggleDirection: () => void;
  onToggleSpread: () => void;
  onToggleUpscale: () => void;
  onToggleOrientation: () => void;
  onToggleBookmark: () => void;
  onToggleFavorite: () => void;
  onToggleFullscreen: () => void;
  onAddToHomeScreenHint: () => void;
}

export default function ComicReaderControls({
  prefs,
  isBookmarked,
  isFavorite,
  isFullscreen,
  orientationLocked,
  orientationSupported,
  fullscreenSupported,
  isStandalone,
  onCycleZoom,
  onToggleDirection,
  onToggleSpread,
  onToggleUpscale,
  onToggleOrientation,
  onToggleBookmark,
  onToggleFavorite,
  onToggleFullscreen,
  onAddToHomeScreenHint,
}: ComicReaderControlsProps) {
  const buttonClass = 'h-9 w-9 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50';

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onCycleZoom}
              aria-label={`Cycle zoom mode. Current: ${prefs.zoomMode}`}
              className={buttonClass}
            >
              <ZoomIn className="h-4.5 w-4.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom: {prefs.zoomMode}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleDirection}
              aria-label={`Toggle reading direction. Current: ${prefs.direction.toUpperCase()}`}
              className={buttonClass}
            >
              <ArrowLeftRight className="h-4.5 w-4.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Direction: {prefs.direction.toUpperCase()}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleSpread}
              aria-label={`Toggle spread mode. Current: ${prefs.spread}`}
              className={cn(buttonClass, prefs.spread === 'double' && 'text-primary hover:text-primary')}
            >
              {prefs.spread === 'double' ? (
                <Columns2 className="h-4.5 w-4.5" />
              ) : (
                <PanelTop className="h-4.5 w-4.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Spread: {prefs.spread}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleUpscale}
              aria-label={`Toggle HD upscaling. Current: ${prefs.upscale ? 'on' : 'off'}`}
              className={cn(buttonClass, prefs.upscale && 'text-primary hover:text-primary')}
            >
              <Sparkles className="h-4.5 w-4.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>HD upscale: {prefs.upscale ? 'On' : 'Off'}</TooltipContent>
        </Tooltip>

        {orientationSupported && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleOrientation}
                aria-label={orientationLocked ? 'Unlock orientation' : 'Lock to landscape'}
                className={cn(buttonClass, orientationLocked && 'text-primary hover:text-primary')}
              >
                {orientationLocked ? (
                  <Lock className="h-4.5 w-4.5" />
                ) : (
                  <RotateCw className="h-4.5 w-4.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{orientationLocked ? 'Unlock orientation' : 'Lock to landscape'}</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleBookmark}
              aria-label="Bookmark current page"
              className={cn(buttonClass, isBookmarked && 'text-yellow-500 hover:text-yellow-400')}
            >
              <Bookmark className={cn('h-4.5 w-4.5', isBookmarked && 'fill-current')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isBookmarked ? 'Remove bookmark' : 'Bookmark page'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggleFavorite}
              aria-label="Toggle favorite"
              className={cn(buttonClass, isFavorite && 'text-red-500 hover:text-red-400')}
            >
              <Heart className={cn('h-4.5 w-4.5', isFavorite && 'fill-current')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isFavorite ? 'Remove favorite' : 'Add favorite'}</TooltipContent>
        </Tooltip>

        {fullscreenSupported ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleFullscreen}
                aria-label="Toggle fullscreen"
                className={buttonClass}
              >
                {isFullscreen ? <Minimize className="h-4.5 w-4.5" /> : <Maximize className="h-4.5 w-4.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</TooltipContent>
          </Tooltip>
        ) : isStandalone ? null : (
          // iOS Safari: no element Fullscreen API. Offer Add to Home Screen instead.
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onAddToHomeScreenHint}
                aria-label="How to go fullscreen"
                className={buttonClass}
              >
                <Smartphone className="h-4.5 w-4.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add to Home Screen for fullscreen</TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
