/** Color swatch picker shown over a live text selection, plus a remove action
 *  when the tap landed on an existing highlight instead. */
import EpubPopover, { type PopoverAnchor } from "./EpubPopover";
import { SWATCHES, type SwatchId } from "../lib/highlights";

export interface HighlightPopoverState {
  anchor: PopoverAnchor;
  cfiRange: string;
  /** Set when re-opening an existing highlight; drives the checked swatch and
   *  reveals Remove. */
  existing: SwatchId | null;
}

export default function HighlightPopover({
  state,
  onPick,
  onRemove,
  onClose,
}: {
  state: HighlightPopoverState;
  onPick: (color: SwatchId) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <EpubPopover anchor={state.anchor} onClose={onClose} className="epub-pop-hl">
      <div className="hl-swatches">
        {SWATCHES.map((s) => (
          <button
            key={s.id}
            className={`hl-swatch${state.existing === s.id ? " active" : ""}`}
            style={{ background: s.chip }}
            onClick={() => onPick(s.id)}
            aria-label={s.label}
          />
        ))}
      </div>
      {state.existing && (
        <button className="hl-remove" onClick={onRemove}>
          Remove
        </button>
      )}
    </EpubPopover>
  );
}
