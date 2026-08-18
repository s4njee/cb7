import type { Ref, SyntheticEvent } from 'react';
import type { ReaderPrefs } from '@/store/readerStore';
import { cn } from '@/lib/utils';

/**
 * @module
 * Comic Reader Presentational View
 *
 * Architecture overview for Junior Devs:
 * This is the "view" half of the comic reader, split out from the container that
 * owns the state and page-loading logic. It is purely presentational: given the
 * current image sources, loading flags, layout preferences, and a page hint, it
 * renders the stage, one or two page images (single vs. double-page spread), the
 * left/right tap zones, and the page-position hint. User intent is reported back
 * via the `onTurnLeft` / `onTurnRight` callbacks. It holds no state of its own.
 *
 * Note the `data-*` attributes on the root and images: the actual zoom/spread/
 * transition styling lives in CSS that keys off these, so this component only has
 * to set the right data values rather than compute styles itself.
 */

interface ComicReaderViewProps {
  readerBodyRef: Ref<HTMLDivElement>;
  stageRef: Ref<HTMLDivElement>;
  prefs: ReaderPrefs;
  imgSrc: string;
  img2Src: string;
  imgLoading: boolean;
  img2Loading: boolean;
  hintText: string;
  hintVisible: boolean;
  onTurnLeft: () => void;
  onTurnRight: () => void;
}

/**
 * Suppress a React synthetic event's default behaviour.
 * Used on the page images to block native drag/select so dragging a page
 *          doesn't start an image-drag or text selection.
 * @param event The synthetic event to suppress.
 */
function preventDefault(event: SyntheticEvent): void {
  event.preventDefault();
}

/**
 * Render the comic reader UI from props supplied by its container.
 * Stateless view component. Shows a second page only in double-spread
 *          mode when a second source is available; layout is driven by the
 *          `data-*` attributes plus CSS. Tap zones invoke the turn callbacks.
 * @param props The page sources, loading flags, layout prefs, hint state, refs,
 *              and page-turn callbacks.
 * @returns The rendered comic reader view.
 */
export default function ComicReaderView({
  readerBodyRef,
  stageRef,
  prefs,
  imgSrc,
  img2Src,
  imgLoading,
  img2Loading,
  hintText,
  hintVisible,
  onTurnLeft,
  onTurnRight,
}: ComicReaderViewProps) {
  return (
    <div
      ref={readerBodyRef}
      id="comic-reader"
      className="comic-reader w-full h-full relative overflow-hidden bg-black flex items-center justify-center"
      data-zoom={prefs.zoomMode}
      data-direction={prefs.direction}
      data-spread={prefs.spread}
      data-transition={prefs.transition}
    >
      <div
        ref={stageRef}
        className="comic-stage flex items-center justify-center w-full h-full transition-transform duration-75 select-none"
      >
        <img
          src={imgSrc}
          alt="Comic Page Left"
          id="comic-page-img"
          className={cn(
            'comic-page-img object-contain select-none max-w-full max-h-full transition-opacity duration-150',
            imgLoading ? 'opacity-30 loading' : 'opacity-100',
          )}
          data-zoom={prefs.zoomMode}
          draggable={false}
          onDragStart={preventDefault}
          onMouseDown={preventDefault}
        />

        {prefs.spread === 'double' && img2Src && (
          <img
            src={img2Src}
            alt="Comic Page Right"
            className={cn(
              'comic-page-img comic-page-img-secondary object-contain select-none max-w-full max-h-full transition-opacity duration-150',
              img2Loading ? 'opacity-30 loading' : 'opacity-100',
            )}
            data-zoom={prefs.zoomMode}
            draggable={false}
            onDragStart={preventDefault}
            onMouseDown={preventDefault}
          />
        )}
      </div>

      <div
        onClick={(event) => {
          event.stopPropagation();
          onTurnLeft();
        }}
        className="reader-tap-zone tap-prev cursor-w-resize"
      />
      <div
        onClick={(event) => {
          event.stopPropagation();
          onTurnRight();
        }}
        className="reader-tap-zone tap-next cursor-e-resize"
      />

      <div id="page-hint" className={cn('page-hint z-40 select-none', !hintVisible && 'fade')}>
        {hintText}
      </div>
    </div>
  );
}
