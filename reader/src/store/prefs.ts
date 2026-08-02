/** Persisted reading preferences (zustand + persist). */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEFAULT_ACCENT,
  DEFAULT_FONT_ID,
  type AccentName,
  type FontId,
} from "../lib/fonts";

/** Page canvas only — app chrome is always Hearth Noir dark. */
export type ThemeName = "dark" | "sepia" | "light";
/** Comics + PDFs: one page, two-page spread, or continuous vertical scroll. */
export type ComicMode = "single" | "spread" | "scroll";
/** EPUB flow: column pagination, or one continuous vertical scroll. */
export type FlowMode = "paginated" | "scrolled";
/** Reflowable EPUB columns when paginated (1 = single page, 2 = two-page). */
export type EpubColumns = 1 | 2;

export interface PrefsState {
  /** Reading page theme (book canvas). Does not retheme app chrome. */
  theme: ThemeName;
  /** App accent color — surfaces stay fixed; only --accent swaps. */
  accent: AccentName;
  fontScale: number; // 0.8 – 1.5
  lineHeight: number; // 1.4 – 2.1
  brightness: number; // 0.25 – 1
  /** Layout for comics *and* PDFs. */
  comicMode: ComicMode;
  /** Default reading typeface; a per-book choice in `bookFonts` wins. */
  fontId: FontId;
  /** Per-book typeface override, keyed by book id. */
  bookFonts: Record<string, FontId>;
  flow: FlowMode;
  /** Two-page (dual column) when EPUB flow is paginated. Ignored while scrolling. */
  epubColumns: EpubColumns;
  /** Horizontal page margin, as a fraction of the viewport (0 – 0.18). */
  margin: number;
  /** Max text measure in `ch`; 0 = unconstrained (fill the column). */
  columnWidth: number;
  /** Manga page direction — reverses spread order, paging and the thumb strip. */
  rtl: boolean;
  /** Hide the OS status/nav bars while reading. */
  immersive: boolean;
  /** Tap feedback on page turns and chapter boundaries (mobile only). */
  haptics: boolean;
  setTheme: (t: ThemeName) => void;
  setAccent: (a: AccentName) => void;
  setFontScale: (n: number) => void;
  setLineHeight: (n: number) => void;
  setBrightness: (n: number) => void;
  setComicMode: (m: ComicMode) => void;
  setFontId: (id: FontId) => void;
  setBookFont: (bookId: number, id: FontId | null) => void;
  setFlow: (f: FlowMode) => void;
  setEpubColumns: (n: EpubColumns) => void;
  setMargin: (n: number) => void;
  setColumnWidth: (n: number) => void;
  setRtl: (b: boolean) => void;
  setImmersive: (b: boolean) => void;
  setHaptics: (b: boolean) => void;
  /** Clear per-book overrides for one book (typeface today). */
  resetBookOverrides: (bookId: number) => void;
  /** Restore factory reading defaults; keeps app accent. Clears all book fonts. */
  resetAllReaderDefaults: () => void;
}

/** Resolve the typeface for a book — its override, else the global default. */
export function fontIdFor(state: PrefsState, bookId: number): FontId {
  return state.bookFonts[String(bookId)] ?? state.fontId;
}

/** Factory defaults for reading prefs. Accent is app chrome and is not reset
 *  by “Reset all reader defaults”. */
export const READER_DEFAULTS = {
  theme: "dark" as ThemeName,
  fontScale: 1.06,
  lineHeight: 1.72,
  brightness: 1,
  comicMode: "spread" as ComicMode,
  fontId: DEFAULT_FONT_ID as FontId,
  flow: "paginated" as FlowMode,
  epubColumns: 1 as EpubColumns,
  margin: 0.06,
  columnWidth: 0,
  rtl: false,
  immersive: false,
  haptics: true,
};

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      theme: READER_DEFAULTS.theme,
      accent: DEFAULT_ACCENT,
      fontScale: READER_DEFAULTS.fontScale,
      lineHeight: READER_DEFAULTS.lineHeight,
      brightness: READER_DEFAULTS.brightness,
      comicMode: READER_DEFAULTS.comicMode,
      fontId: READER_DEFAULTS.fontId,
      bookFonts: {},
      flow: READER_DEFAULTS.flow,
      epubColumns: READER_DEFAULTS.epubColumns,
      margin: READER_DEFAULTS.margin,
      columnWidth: READER_DEFAULTS.columnWidth,
      rtl: READER_DEFAULTS.rtl,
      immersive: READER_DEFAULTS.immersive,
      // On by default: the tick is the kind of thing you only notice when it's
      // missing, and a reader who dislikes it (or has haptics off system-wide)
      // is one toggle away. Desktop never fires regardless.
      haptics: READER_DEFAULTS.haptics,
      setTheme: (theme) => set({ theme }),
      setAccent: (accent) => set({ accent }),
      setFontScale: (fontScale) => set({ fontScale }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setBrightness: (brightness) => set({ brightness }),
      setComicMode: (comicMode) => set({ comicMode }),
      setFontId: (fontId) => set({ fontId }),
      setBookFont: (bookId, id) =>
        set((s) => {
          const next = { ...s.bookFonts };
          if (id) next[String(bookId)] = id;
          else delete next[String(bookId)];
          return { bookFonts: next };
        }),
      setFlow: (flow) => set({ flow }),
      setEpubColumns: (epubColumns) => set({ epubColumns }),
      setMargin: (margin) => set({ margin }),
      setColumnWidth: (columnWidth) => set({ columnWidth }),
      setRtl: (rtl) => set({ rtl }),
      setImmersive: (immersive) => set({ immersive }),
      setHaptics: (haptics) => set({ haptics }),
      /** Drop per-book typeface override for one open book. */
      resetBookOverrides: (bookId: number) =>
        set((s) => {
          if (s.bookFonts[String(bookId)] == null) return s;
          const next = { ...s.bookFonts };
          delete next[String(bookId)];
          return { bookFonts: next };
        }),
      /** Restore global reading defaults; keeps app accent. Clears all book fonts. */
      resetAllReaderDefaults: () =>
        set({
          ...READER_DEFAULTS,
          bookFonts: {},
        }),
    }),
    {
      name: "shelf.prefs",
      version: 4,
      // v1 stored a `serif` boolean; v2 replaces it with a font registry id.
      // v3 adds accent + Hearth Noir default face (newsreader).
      // v4 adds epubColumns (two-page text).
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown> & {
          serif?: boolean;
          fontId?: string;
          accent?: string;
          epubColumns?: number;
        };
        if (version < 2) {
          state.fontId = state.serif === false ? "system" : DEFAULT_FONT_ID;
          delete state.serif;
        }
        if (version < 3) {
          if (!state.accent) state.accent = DEFAULT_ACCENT;
        }
        if (version < 4) {
          if (state.epubColumns !== 1 && state.epubColumns !== 2) {
            state.epubColumns = 1;
          }
        }
        return state as unknown as PrefsState;
      },
    },
  ),
);
