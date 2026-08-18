/** How the shelf is laid out — kept apart from reading prefs, and kept *per
 *  device class*.
 *
 *  A phone wants a tight grid with the words trimmed; an iPad wants room; a
 *  desktop window wants a list when you are hunting by title. One shared
 *  setting means whichever device you touched last decides for all of them, so
 *  each class keeps its own record and they never overwrite each other.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isDesktop } from "../lib/platform";

/** Grid of covers, or a dense row-per-book list. */
export type LayoutMode = "grid" | "list";
/** How much air each card gets. */
export type Density = "comfortable" | "compact";
/** Which of the three shapes of device this is. */
export type DeviceClass = "phone" | "tablet" | "desktop";

export interface DisplayPrefs {
  layout: LayoutMode;
  density: Density;
  /** The status line under each cover. Off leaves title-only. */
  showMeta: boolean;
}

export const DISPLAY_DEFAULTS: DisplayPrefs = {
  layout: "grid",
  density: "comfortable",
  showMeta: true,
};

/** Tablets and phones split at the usual 768px; a desktop build is a desktop
 *  whatever its window is doing, because resizing a window is not changing
 *  device. Width is passed in rather than read so this stays pure. */
export function deviceClassFor(width: number, desktopApp: boolean): DeviceClass {
  if (desktopApp) return "desktop";
  return width >= 768 ? "tablet" : "phone";
}

export function currentDeviceClass(): DeviceClass {
  const width = typeof window === "undefined" ? 1280 : window.innerWidth;
  return deviceClassFor(width, isDesktop());
}

interface DisplayState {
  /** Per device class; absent classes fall back to the defaults. */
  byDevice: Partial<Record<DeviceClass, DisplayPrefs>>;
  set: (device: DeviceClass, patch: Partial<DisplayPrefs>) => void;
  /** "Reset view" — this device class only. The others are not yours to undo. */
  reset: (device: DeviceClass) => void;
}

export const useDisplay = create<DisplayState>()(
  persist(
    (set) => ({
      byDevice: {},
      set: (device, patch) =>
        set((state) => ({
          byDevice: {
            ...state.byDevice,
            [device]: { ...DISPLAY_DEFAULTS, ...state.byDevice[device], ...patch },
          },
        })),
      reset: (device) =>
        set((state) => {
          const next = { ...state.byDevice };
          delete next[device];
          return { byDevice: next };
        }),
    }),
    { name: "shelf.display" },
  ),
);

/** The settings in force for one device class. */
export function displayFor(
  byDevice: Partial<Record<DeviceClass, DisplayPrefs>>,
  device: DeviceClass,
): DisplayPrefs {
  return { ...DISPLAY_DEFAULTS, ...byDevice[device] };
}

/** Is this class showing anything other than the factory view? Drives whether
 *  "Reset view" is worth offering. */
export function isDisplayCustomized(prefs: DisplayPrefs): boolean {
  return (
    prefs.layout !== DISPLAY_DEFAULTS.layout ||
    prefs.density !== DISPLAY_DEFAULTS.density ||
    prefs.showMeta !== DISPLAY_DEFAULTS.showMeta
  );
}

/** Class names the shelf container carries, so layout stays in CSS instead of
 *  branching the card component into two shapes. */
export function gridClassName(prefs: DisplayPrefs): string {
  return [
    "grid",
    prefs.layout === "list" ? "as-list" : "",
    prefs.density === "compact" ? "is-compact" : "",
    prefs.showMeta ? "" : "no-meta",
  ]
    .filter(Boolean)
    .join(" ");
}
