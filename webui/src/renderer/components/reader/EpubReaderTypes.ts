import type { buildEpubTheme } from '../../../shared/epubTheme';

export interface EpubChapter {
  href: string;
  label?: string;
}

export interface EpubNavigation {
  toc?: EpubChapter[];
}

export interface EpubContent {
  document?: Document;
}

export interface EpubSection {
  index?: number;
  href?: string;
  canonical?: string;
}

export interface EpubSpine {
  get: (target?: string | number) => EpubSection | null;
}

export interface EpubView {
  contents?: EpubContent;
  iframe?: HTMLIFrameElement;
  document?: Document;
}

export interface EpubLocation {
  start?: {
    percentage?: number;
    cfi?: string;
    href?: string;
  };
}

export interface EpubRendition {
  themes: {
    default: (theme: ReturnType<typeof buildEpubTheme>) => void;
    font: (fontFamily: string) => void;
    fontSize: (fontSize: string) => void;
    override: (name: string, value: string, priority?: boolean) => void;
  };
  manager?: {
    views?: {
      _views?: EpubView[];
    };
  };
  getContents?: () => EpubContent[];
  on: {
    (event: 'relocated', callback: (location: EpubLocation) => void): void;
    (event: 'rendered', callback: (section: unknown, view: EpubView) => void): void;
  };
  display: (target?: string | number) => Promise<void>;
  next: () => void;
  prev: () => void;
  resize: () => void;
  spread: (mode: 'auto' | 'none') => void;
  destroy: () => void;
  /** The current rendered location; epubjs updates this on every relocate. */
  location?: EpubLocation;
  _onKey?: (event: KeyboardEvent) => void;
}

export interface EpubLocations {
  generate: (charsPerLocation?: number) => Promise<string[]>;
  percentageFromCfi: (cfi: string) => number | null;
  length: () => number;
}

export interface EpubBook {
  loaded: {
    navigation: Promise<EpubNavigation>;
  };
  /** Resolves once the book's package/spine metadata is parsed. */
  ready?: Promise<unknown>;
  /** epub.js location index; empty until `locations.generate()` runs. */
  locations?: EpubLocations;
  spine?: EpubSpine;
  renderTo: (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      spread: 'auto' | 'none';
      flow: 'paginated';
    }
  ) => EpubRendition;
  destroy?: () => void;
}

export type EpubFactory = (data: ArrayBuffer) => EpubBook;
