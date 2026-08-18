/** Footnote preview — the resolved note text, shown in place of navigating the
 *  reader away from the paragraph they were mid-sentence in. */
import EpubPopover, { type PopoverAnchor } from "./EpubPopover";
import { CloseIcon } from "./icons";

export interface FootnoteState {
  anchor: PopoverAnchor;
  label: string;
  text: string;
  /** Book-relative href of the note itself, for the escape hatch. */
  target: string;
}

export default function FootnotePopover({
  state,
  onClose,
  onOpen,
}: {
  state: FootnoteState;
  onClose: () => void;
  /** Escape hatch to the real target, for notes too long to preview. */
  onOpen: () => void;
}) {
  return (
    <EpubPopover anchor={state.anchor} onClose={onClose} className="epub-pop-note">
      <div className="epub-pop-head">
        <span className="epub-pop-label">{state.label}</span>
        <button className="epub-pop-x" onClick={onClose} aria-label="Close">
          <CloseIcon size={15} />
        </button>
      </div>
      <div className="epub-pop-body">{state.text}</div>
      <button className="epub-pop-action" onClick={onOpen}>
        Go to note
      </button>
    </EpubPopover>
  );
}
