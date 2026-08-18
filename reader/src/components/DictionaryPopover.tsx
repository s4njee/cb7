/** Dictionary definition popover. Renders the three states a lookup can land
 *  in — pending, an entry, or a graceful nothing — since an offline reader hits
 *  the last one constantly and it must read as ordinary, not as an error. */
import EpubPopover, { type PopoverAnchor } from "./EpubPopover";
import { CloseIcon } from "./icons";
import type { DictionaryResult } from "../lib/dictionary";

export interface DictionaryState {
  anchor: PopoverAnchor;
  word: string;
  /** Null while the lookup is in flight. */
  result: DictionaryResult | null;
}

export default function DictionaryPopover({
  state,
  onClose,
}: {
  state: DictionaryState;
  onClose: () => void;
}) {
  const { result } = state;
  const heading =
    result?.status === "found" ? result.entry.word : state.word;

  return (
    <EpubPopover anchor={state.anchor} onClose={onClose} className="epub-pop-dict">
      <div className="epub-pop-head">
        <span className="epub-pop-word">{heading}</span>
        {result?.status === "found" && result.entry.phonetic && (
          <span className="epub-pop-phon">{result.entry.phonetic}</span>
        )}
        <button className="epub-pop-x" onClick={onClose} aria-label="Close">
          <CloseIcon size={15} />
        </button>
      </div>

      {result === null && <div className="epub-pop-muted">Looking up…</div>}
      {result?.status === "missing" && (
        <div className="epub-pop-muted">No definition found.</div>
      )}
      {result?.status === "unavailable" && (
        <div className="epub-pop-muted">Unavailable offline.</div>
      )}
      {result?.status === "found" && (
        <div className="epub-pop-body">
          {result.entry.senses.map((sense, i) => (
            <div className="dict-sense" key={`${sense.partOfSpeech}-${i}`}>
              {sense.partOfSpeech && <div className="dict-pos">{sense.partOfSpeech}</div>}
              <ol className="dict-defs">
                {sense.definitions.map((d, j) => (
                  <li key={j}>{d}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </EpubPopover>
  );
}
