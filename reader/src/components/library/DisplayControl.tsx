/** "View" pill beside Sort: layout, density, the optional metadata line, and
 *  the one Reset. Same shape as `SortControl` — a pill that opens a small menu
 *  — because these are the same kind of decision and should not look like two
 *  different kinds of control.
 *
 *  The menu names the device class it is editing. Without that, a setting that
 *  visibly does not follow you to your iPad reads as a bug rather than as the
 *  feature it is. */
import { useEffect, useRef, useState } from "react";
import {
  DISPLAY_DEFAULTS,
  isDisplayCustomized,
  type DeviceClass,
  type Density,
  type DisplayPrefs,
  type LayoutMode,
} from "../../store/display";

const DEVICE_LABEL: Record<DeviceClass, string> = {
  phone: "this phone",
  tablet: "this tablet",
  desktop: "this desktop",
};

const LAYOUTS: Array<{ value: LayoutMode; label: string }> = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
];

const DENSITIES: Array<{ value: Density; label: string }> = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

export default function DisplayControl({
  prefs,
  device,
  onChange,
  onReset,
}: {
  prefs: DisplayPrefs;
  device: DeviceClass;
  onChange: (patch: Partial<DisplayPrefs>) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="sort-control" ref={ref}>
      <button
        className={`sort-pill${open ? " active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="View"
      >
        <span className="sort-pill-label">View</span>
      </button>

      {open && (
        <div className="sort-menu" role="menu">
          <div className="sort-menu-eyebrow">Layout</div>
          {LAYOUTS.map((option) => (
            <button
              key={option.value}
              className={`sort-menu-item${prefs.layout === option.value ? " active" : ""}`}
              role="menuitemradio"
              aria-checked={prefs.layout === option.value}
              onClick={() => onChange({ layout: option.value })}
            >
              {option.label}
              {prefs.layout === option.value && <span className="sort-check">✓</span>}
            </button>
          ))}

          <div className="sort-menu-sep" />
          <div className="sort-menu-eyebrow">Density</div>
          {DENSITIES.map((option) => (
            <button
              key={option.value}
              className={`sort-menu-item${prefs.density === option.value ? " active" : ""}`}
              role="menuitemradio"
              aria-checked={prefs.density === option.value}
              onClick={() => onChange({ density: option.value })}
            >
              {option.label}
              {prefs.density === option.value && <span className="sort-check">✓</span>}
            </button>
          ))}

          <div className="sort-menu-sep" />
          <button
            className={`sort-menu-item${prefs.showMeta ? " active" : ""}`}
            role="menuitemcheckbox"
            aria-checked={prefs.showMeta}
            onClick={() => onChange({ showMeta: !prefs.showMeta })}
          >
            Show details
            {prefs.showMeta && <span className="sort-check">✓</span>}
          </button>

          <div className="sort-menu-sep" />
          <button
            className="sort-menu-item"
            role="menuitem"
            disabled={!isDisplayCustomized(prefs)}
            onClick={() => {
              onReset();
              setOpen(false);
            }}
          >
            Reset view
          </button>
          <div className="sort-menu-note">
            Saved for {DEVICE_LABEL[device]} — your other devices keep their own.
            {isDisplayCustomized(prefs) ? "" : " Currently the default view."}
          </div>
        </div>
      )}
    </div>
  );
}

export { DISPLAY_DEFAULTS };
