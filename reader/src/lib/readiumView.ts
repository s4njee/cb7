/**
 * Thin helpers around @readium/navigator EpubNavigator for the Tauri reader.
 */
import {
  EpubNavigator,
  TextAlignment,
  type EpubNavigatorListeners,
  type IEpubPreferences,
} from "@readium/navigator";
import { Locator, type Publication } from "@readium/shared";
import { epubColors } from "./epubTheme";
import type { ThemeName } from "../store/prefs";
import type { FontId } from "./fonts";
import { fontById } from "./fonts";

export type { Publication };
export { EpubNavigator, Locator };

export function themeToPreferences(
  theme: ThemeName,
  opts: {
    fontId: FontId;
    fontScale: number;
    lineHeight: number;
    scroll: boolean;
    columnCount: 1 | 2;
  },
): IEpubPreferences {
  const c = epubColors(theme);
  const font = fontById(opts.fontId);
  return {
    backgroundColor: c.bg,
    textColor: c.fg,
    linkColor: c.fg,
    visitedColor: c.fg,
    fontFamily: font.stack,
    // Readium fontSize is a unitless scale in [.7, 4] (1 = default), not percent.
    fontSize: Math.min(4, Math.max(0.7, opts.fontScale)),
    lineHeight: opts.lineHeight,
    scroll: opts.scroll,
    columnCount: opts.scroll ? 1 : opts.columnCount,
    // Page gutters leave a rim of iframe chrome (reads as a grey border on
    // light themes under `color-scheme: dark` app chrome). Margins live on
    // `.epub-measure` instead.
    pageGutter: 0,
    // null = fill the host width. Default max ~80ch shrinks the navigator
    // container and leaves a framed “text box” look.
    maximalLineLength: null,
    minimalLineLength: null,
    textAlign: TextAlignment.start,
    hyphens: false,
  };
}

export interface CreateNavigatorArgs {
  container: HTMLElement;
  publication: Publication;
  positions: Locator[];
  initialLocator?: Locator;
  preferences: IEpubPreferences;
  listeners: Partial<EpubNavigatorListeners>;
}

/**
 * Readium CSS defaults `--RS__colGap: 0` and never maps a user preference to
 * it (only `pageGutter` is wired, which is outer padding — not the gap between
 * columns). Without this, two-page mode draws columns flush against each other.
 */
const TWO_PAGE_COL_GAP_PX = 48;

type NavigatorCssInternals = {
  _css?: {
    rsProperties: { colGap: number | null };
  };
  compileCSSProperties?: (css: unknown) => Record<string, string>;
  pool?: { setCSSProperties: (props: Record<string, string>) => void };
};

/** Apply inter-column gap for dual-page; clear it for single column. */
export function syncColumnGap(nav: EpubNavigator, columnCount: 1 | 2): void {
  const n = nav as unknown as NavigatorCssInternals;
  if (!n._css?.rsProperties || !n.pool || !n.compileCSSProperties) return;
  const gap = columnCount === 2 ? TWO_PAGE_COL_GAP_PX : 0;
  n._css.rsProperties.colGap = gap;
  const props = n.compileCSSProperties(n._css);
  n.pool.setCSSProperties(props);
}

export async function createAndLoadNavigator(
  args: CreateNavigatorArgs,
): Promise<EpubNavigator> {
  const listeners: EpubNavigatorListeners = {
    frameLoaded: args.listeners.frameLoaded ?? (() => {}),
    positionChanged: args.listeners.positionChanged ?? (() => {}),
    timelineItemChanged: args.listeners.timelineItemChanged ?? (() => {}),
    tap: args.listeners.tap ?? (() => false),
    click: args.listeners.click ?? (() => false),
    zoom: args.listeners.zoom ?? (() => {}),
    miscPointer: args.listeners.miscPointer ?? (() => {}),
    scroll: args.listeners.scroll ?? (() => {}),
    customEvent: args.listeners.customEvent ?? (() => {}),
    handleLocator: args.listeners.handleLocator ?? (() => false),
    textSelected: args.listeners.textSelected ?? (() => {}),
    contentProtection: args.listeners.contentProtection ?? (() => {}),
    contextMenu: args.listeners.contextMenu ?? (() => {}),
    peripheral: args.listeners.peripheral ?? (() => {}),
  };

  const columns = (args.preferences.columnCount === 2 ? 2 : 1) as 1 | 2;

  const nav = new EpubNavigator(
    args.container,
    args.publication,
    listeners,
    args.positions,
    args.initialLocator,
    {
      preferences: args.preferences,
      defaults: {
        fontSize: 1,
        lineHeight: 1.5,
        scroll: false,
        columnCount: 1,
        pageGutter: 0,
        maximalLineLength: null,
        minimalLineLength: null,
        // Match prefs so the first paint isn't white before submitPreferences.
        backgroundColor: args.preferences.backgroundColor ?? null,
        textColor: args.preferences.textColor ?? null,
      },
    },
  );
  await nav.load();
  syncColumnGap(nav, columns);
  return nav;
}

export function locatorToProgressString(locator: Locator): string {
  try {
    return JSON.stringify(locator.serialize());
  } catch {
    return locator.href;
  }
}

export function progressStringToLocator(raw: string | null | undefined): Locator | undefined {
  if (!raw) return undefined;
  try {
    const json = JSON.parse(raw);
    return Locator.deserialize(json) ?? undefined;
  } catch {
    // Legacy CFI / bare href — best-effort href-only locator
    if (raw.startsWith("epubcfi")) return undefined;
    return Locator.deserialize({ href: raw, type: "application/xhtml+xml" }) ?? undefined;
  }
}

export function totalProgressionOf(locator: Locator | undefined): number | undefined {
  const p = locator?.locations?.totalProgression;
  return typeof p === "number" && !Number.isNaN(p) ? p : undefined;
}
